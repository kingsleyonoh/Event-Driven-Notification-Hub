import { eq, and, or, isNull, gt, sql as sqlOp } from 'drizzle-orm';
import { notifications, digestQueue, templates, tenantSuppressions } from '../db/schema.js';
import { resolveDeliveryAddress, checkOptOut, isWithinQuietHours } from './preferences.js';
import { isDuplicate } from './deduplicator.js';
import { renderSubjectAndBody, renderTemplate } from '../templates/renderer.js';
import { computeScheduledFor } from '../lib/scheduling.js';
import { dispatch, type DispatchConfig } from '../channels/dispatcher.js';
import { fetchAttachments } from '../channels/attachments.js';
import { AttachmentFetchError } from '../lib/errors.js';
import type { EmailAttachment } from '../channels/email.js';
import { createLogger } from '../lib/logger.js';
import type { Database } from '../db/client.js';
import type { KafkaEvent } from '../consumer/kafka.js';

const logger = createLogger('pipeline');

interface RuleRecord {
  id: string;
  tenantId: string;
  eventType: string;
  channel: 'email' | 'sms' | 'in_app' | 'telegram';
  templateId: string;
  recipientType: string;
  recipientValue: string;
  urgency: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface PipelineConfig {
  dedupWindowMinutes: number;
  digestSchedule: 'hourly' | 'daily' | 'weekly';
  dispatch?: DispatchConfig;
  tenantConfig?: Record<string, unknown> | null;
}

export async function processNotification(
  db: Database,
  event: KafkaEvent,
  rule: RuleRecord,
  recipient: string,
  config: PipelineConfig,
): Promise<void> {
  const { tenant_id: tenantId, event_id: eventId, event_type: eventType, payload } = event;

  // 1. Resolve delivery address
  let deliveryAddress: string;
  let preferences: Awaited<ReturnType<typeof resolveDeliveryAddress>>['preferences'] = null;

  if (rule.recipientType === 'static') {
    // Static recipients ARE the delivery address — no DB lookup needed
    deliveryAddress = recipient;
  } else if (isDirectAddress(recipient, rule.channel)) {
    // event_field extracted a direct address (email with @, phone with +) — use as-is
    deliveryAddress = recipient;
  } else {
    // event_field extracted a user ID — look up delivery address from preferences
    const result = await resolveDeliveryAddress(db, tenantId, recipient, rule.channel);
    preferences = result.preferences;

    if (!result.address && rule.channel !== 'in_app') {
      await insertNotification(db, {
        tenantId, ruleId: rule.id, eventType, eventId, recipient,
        channel: rule.channel, status: 'skipped', skipReason: 'no_delivery_address',
      });
      logger.info({ eventId, recipient }, 'skipped — no delivery address');
      return;
    }

    deliveryAddress = result.address ?? recipient;
  }

  // 2. Check opt-out
  if (preferences && checkOptOut(preferences.optOut, rule.channel, eventType)) {
    await insertNotification(db, {
      tenantId, ruleId: rule.id, eventType, eventId, recipient,
      channel: rule.channel, status: 'skipped', skipReason: 'opt_out',
    });
    logger.info({ eventId, recipient }, 'skipped — opt_out');
    return;
  }

  // 3. Dedup check
  if (await isDuplicate(db, tenantId, eventId, recipient, rule.channel, config.dedupWindowMinutes)) {
    await insertNotification(db, {
      tenantId, ruleId: rule.id, eventType, eventId, recipient,
      channel: rule.channel, status: 'skipped', skipReason: 'deduplicated',
    });
    logger.info({ eventId, recipient }, 'skipped — deduplicated');
    return;
  }

  // 3.5 Suppression check (Phase 7 H10) — pre-dispatch guard for email/sms/telegram.
  // in_app uses userId, not an addressable contact — suppression doesn't apply there.
  if (rule.channel !== 'in_app') {
    const suppressed = await isSuppressed(db, tenantId, deliveryAddress);
    if (suppressed) {
      await insertNotification(db, {
        tenantId, ruleId: rule.id, eventType, eventId, recipient,
        channel: rule.channel, status: 'skipped', skipReason: 'suppressed',
      });
      logger.info({ eventId, recipient, deliveryAddress }, 'skipped — suppressed');
      return;
    }
  }

  // 4. Quiet hours check
  if (preferences && isWithinQuietHours(preferences.quietHours)) {
    if (preferences.digestMode) {
      const schedule = preferences.digestSchedule ?? config.digestSchedule;
      await insertDigestNotification(db, {
        tenantId, ruleId: rule.id, eventType, eventId, recipient,
        channel: rule.channel, payload, userId: preferences.userId,
        scheduledFor: computeScheduledFor(schedule),
      });
      return;
    }

    await insertNotification(db, {
      tenantId, ruleId: rule.id, eventType, eventId, recipient,
      channel: rule.channel, status: 'held', payload,
    });
    logger.info({ eventId, recipient }, 'held — quiet hours');
    return;
  }

  // 5. Digest mode (not quiet hours)
  if (preferences?.digestMode) {
    const schedule = preferences.digestSchedule ?? config.digestSchedule;
    await insertDigestNotification(db, {
      tenantId, ruleId: rule.id, eventType, eventId, recipient,
      channel: rule.channel, payload, userId: preferences.userId,
      scheduledFor: computeScheduledFor(schedule),
    });
    return;
  }

  // 6. Resolve template — Phase 7 H9 locale-aware lookup.
  // The rule pins a template by id (the canonical 'en' variant authored against
  // the rule). At dispatch time we pivot from rule.templateId → that template's
  // NAME → search all (tenantId, name, locale) variants for a match, falling
  // back to 'en'. On second miss, mark notification failed with a clear message.
  const requestedLocale =
    typeof payload?.locale === 'string' && payload.locale.length > 0
      ? (payload.locale as string)
      : 'en';

  const [ruleTmpl] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, rule.templateId))
    .limit(1);

  if (!ruleTmpl) {
    await insertNotification(db, {
      tenantId, ruleId: rule.id, eventType, eventId, recipient,
      channel: rule.channel, status: 'failed', errorMessage: 'template not found',
    });
    return;
  }

  let tmpl = ruleTmpl;
  if (ruleTmpl.locale !== requestedLocale) {
    // Try the requested locale.
    const [localeMatch] = await db
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.tenantId, tenantId),
          eq(templates.name, ruleTmpl.name),
          eq(templates.locale, requestedLocale),
        ),
      )
      .limit(1);

    if (localeMatch) {
      tmpl = localeMatch;
    } else if (ruleTmpl.locale === 'en') {
      // Fallback already loaded — the rule's template IS the en variant.
      tmpl = ruleTmpl;
    } else {
      // Try (tenant, name, 'en') as final fallback.
      const [enFallback] = await db
        .select()
        .from(templates)
        .where(
          and(
            eq(templates.tenantId, tenantId),
            eq(templates.name, ruleTmpl.name),
            eq(templates.locale, 'en'),
          ),
        )
        .limit(1);

      if (enFallback) {
        tmpl = enFallback;
      } else {
        await insertNotification(db, {
          tenantId, ruleId: rule.id, eventType, eventId, recipient,
          channel: rule.channel, status: 'failed',
          errorMessage: `Template "${ruleTmpl.name}" not found for locale "${requestedLocale}" (no en fallback)`,
        });
        logger.warn(
          { eventId, recipient, templateName: ruleTmpl.name, locale: requestedLocale },
          'template locale lookup failed — no en fallback exists',
        );
        return;
      }
    }
  }

  const { renderedSubject, renderedBody } = renderSubjectAndBody(
    tmpl.subject, tmpl.body, payload,
  );

  // Phase 7 H8 — render plain-text fallback for email when body_text set.
  let renderedBodyText: string | undefined;
  if (rule.channel === 'email' && tmpl.bodyText && tmpl.bodyText.length > 0) {
    try {
      renderedBodyText = renderTemplate(tmpl.bodyText, payload);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'body_text render failed';
      logger.warn(
        { eventId, recipient, error: errMsg },
        'body_text render failed — falling back to Resend auto-generated text',
      );
    }
  }

  // 7. Insert notification
  const [notif] = await db
    .insert(notifications)
    .values({
      tenantId, ruleId: rule.id, eventType, eventId, recipient,
      channel: rule.channel,
      subject: renderedSubject,
      bodyPreview: renderedBody.slice(0, 500),
      status: 'pending',
    })
    .returning();

  // 7b. Fetch attachments (email channel only, when template has attachments_config)
  let emailAttachments: EmailAttachment[] | undefined;
  if (rule.channel === 'email' && tmpl.attachmentsConfig && tmpl.attachmentsConfig.length > 0) {
    try {
      const fetched = await fetchAttachments(tmpl.attachmentsConfig, payload);
      emailAttachments = fetched.map((a) => ({
        filename: a.filename,
        content: a.content_base64,
      }));
    } catch (err) {
      const isAttachmentError = err instanceof AttachmentFetchError;
      const message = err instanceof Error ? err.message : 'attachment fetch failed';
      logger.error(
        { eventId, recipient, notificationId: notif.id, error: message },
        'attachment fetch failed — marking notification failed, skipping dispatch',
      );
      await db
        .update(notifications)
        .set({
          status: 'failed',
          errorMessage: isAttachmentError ? `attachment fetch failed: ${message}` : message,
        })
        .where(eq(notifications.id, notif.id));
      return;
    }
  }

  // 7c. Render custom email headers (email channel only) — soft-fail per header
  let renderedHeaders: Record<string, string> | undefined;
  if (rule.channel === 'email' && tmpl.headers && Object.keys(tmpl.headers).length > 0) {
    const out: Record<string, string> = {};
    for (const [name, valueTemplate] of Object.entries(tmpl.headers)) {
      try {
        out[name] = renderTemplate(valueTemplate, payload);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'header render failed';
        logger.warn(
          { eventId, recipient, notificationId: notif.id, headerName: name, error: errMsg },
          'header value render failed — skipping this header, continuing dispatch',
        );
      }
    }
    if (Object.keys(out).length > 0) {
      renderedHeaders = out;
    }
  }

  // 8. Dispatch — assemble three-layer reply_to inputs (email channel only)
  const eventReplyTo =
    rule.channel === 'email' && typeof payload?._reply_to === 'string'
      ? (payload._reply_to as string)
      : null;
  const dispatchCfg: DispatchConfig = {
    ...config.dispatch,
    ...(config.tenantConfig ? { tenantConfig: config.tenantConfig } : {}),
    ...(emailAttachments ? { attachments: emailAttachments } : {}),
    ...(rule.channel === 'email' && tmpl.replyTo ? { templateReplyTo: tmpl.replyTo } : {}),
    ...(eventReplyTo ? { eventReplyTo } : {}),
    ...(renderedHeaders ? { headers: renderedHeaders } : {}),
    ...(renderedBodyText ? { text: renderedBodyText } : {}),
  };
  const result = await dispatch(rule.channel, deliveryAddress, renderedSubject, renderedBody, {
    tenantId, notificationId: notif.id, eventType,
  }, dispatchCfg);

  if (result.success) {
    // Phase 7 H5 — sandbox dispatch: notification is "sent" from the pipeline's
    // perspective (it traversed all gates) but Resend was never called. Land
    // it as `sent_sandbox` so tenants can distinguish real sends from sandbox
    // sends in `/api/notifications` listings.
    const isSandbox = result.sandbox === true;
    // For in_app, deliveredAt is set by WebSocket acknowledge — not on dispatch
    const deliveredAt = rule.channel === 'in_app' ? undefined : new Date();
    const finalStatus: 'sent' | 'sent_sandbox' = isSandbox ? 'sent_sandbox' : 'sent';
    await db
      .update(notifications)
      .set({ status: finalStatus, ...(deliveredAt ? { deliveredAt } : {}) })
      .where(eq(notifications.id, notif.id));
    logger.info(
      { eventId, recipient, notificationId: notif.id, sandbox: isSandbox },
      isSandbox ? 'notification sandboxed' : 'notification sent',
    );
  } else {
    await db
      .update(notifications)
      .set({ status: 'failed', errorMessage: result.error ?? 'dispatch failed' })
      .where(eq(notifications.id, notif.id));
  }
}

/**
 * Per-tenant suppression check. Returns true if the recipient is suppressed
 * (and the suppression hasn't expired). Recipient comparison is case-insensitive.
 */
async function isSuppressed(
  db: Database,
  tenantId: string,
  recipient: string,
): Promise<boolean> {
  const now = new Date();
  const [hit] = await db
    .select({ id: tenantSuppressions.id })
    .from(tenantSuppressions)
    .where(
      and(
        eq(tenantSuppressions.tenantId, tenantId),
        sqlOp`lower(${tenantSuppressions.recipient}) = lower(${recipient})`,
        or(isNull(tenantSuppressions.expiresAt), gt(tenantSuppressions.expiresAt, now)),
      ),
    )
    .limit(1);
  return Boolean(hit);
}

function isDirectAddress(value: string, channel: string): boolean {
  if (channel === 'email') return value.includes('@');
  if (channel === 'sms') return /^\+?\d{7,}$/.test(value);
  if (channel === 'telegram') return /^\d{5,}$/.test(value);
  return false;
}

async function insertNotification(
  db: Database,
  data: {
    tenantId: string; ruleId: string; eventType: string; eventId: string;
    recipient: string; channel: 'email' | 'sms' | 'in_app' | 'telegram';
    status: 'pending' | 'sent' | 'failed' | 'queued_digest' | 'skipped' | 'held';
    skipReason?: string; errorMessage?: string; payload?: Record<string, unknown>;
  },
) {
  await db.insert(notifications).values(data);
}

async function insertDigestNotification(
  db: Database,
  data: {
    tenantId: string; ruleId: string; eventType: string; eventId: string;
    recipient: string; channel: 'email' | 'sms' | 'in_app' | 'telegram'; payload: Record<string, unknown>;
    userId: string; scheduledFor: Date;
  },
) {
  const [notif] = await db
    .insert(notifications)
    .values({
      tenantId: data.tenantId, ruleId: data.ruleId, eventType: data.eventType,
      eventId: data.eventId, recipient: data.recipient, channel: data.channel,
      status: 'queued_digest', payload: data.payload,
    })
    .returning();

  await db.insert(digestQueue).values({
    tenantId: data.tenantId,
    userId: data.userId,
    notificationId: notif.id,
    scheduledFor: data.scheduledFor,
  });

  logger.info({ eventId: data.eventId, recipient: data.recipient }, 'queued for digest');
}
