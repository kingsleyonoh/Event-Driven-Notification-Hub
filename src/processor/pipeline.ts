import { eq } from 'drizzle-orm';
import { notifications, digestQueue, templates } from '../db/schema.js';
import { resolveDeliveryAddress, checkOptOut, isWithinQuietHours } from './preferences.js';
import { isDuplicate } from './deduplicator.js';
import { renderSubjectAndBody } from '../templates/renderer.js';
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

  // 6. Render template
  const [tmpl] = await db
    .select()
    .from(templates)
    .where(eq(templates.id, rule.templateId))
    .limit(1);

  if (!tmpl) {
    await insertNotification(db, {
      tenantId, ruleId: rule.id, eventType, eventId, recipient,
      channel: rule.channel, status: 'failed', errorMessage: 'template not found',
    });
    return;
  }

  const { renderedSubject, renderedBody } = renderSubjectAndBody(
    tmpl.subject, tmpl.body, payload,
  );

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
  };
  const result = await dispatch(rule.channel, deliveryAddress, renderedSubject, renderedBody, {
    tenantId, notificationId: notif.id, eventType,
  }, dispatchCfg);

  if (result.success) {
    // For in_app, deliveredAt is set by WebSocket acknowledge — not on dispatch
    const deliveredAt = rule.channel === 'in_app' ? undefined : new Date();
    await db
      .update(notifications)
      .set({ status: 'sent', ...(deliveredAt ? { deliveredAt } : {}) })
      .where(eq(notifications.id, notif.id));
  } else {
    await db
      .update(notifications)
      .set({ status: 'failed', errorMessage: result.error ?? 'dispatch failed' })
      .where(eq(notifications.id, notif.id));
  }
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
