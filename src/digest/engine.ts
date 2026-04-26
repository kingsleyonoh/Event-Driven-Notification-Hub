import { eq, and, lte, sql } from 'drizzle-orm';
import { digestQueue, notifications, templates, notificationRules, userPreferences } from '../db/schema.js';
import { renderSubjectAndBody, renderTemplate } from '../templates/renderer.js';
import { sendEmail, type EmailConfig } from '../channels/email.js';
import { sendTelegram, type TelegramConfig } from '../channels/telegram.js';
import { createLogger } from '../lib/logger.js';
import type { Database } from '../db/client.js';

const logger = createLogger('digest');
const MAX_PER_DIGEST = 50;

interface DigestItem {
  queueId: string;
  tenantId: string;
  userId: string;
  notificationId: string;
  ruleId: string | null;
  eventType: string;
  channel: string;
  payload: Record<string, unknown> | null;
}

/**
 * Phase 7 7b — extended digest options. `telegramConfig` enables per-channel
 * telegram digests. When omitted, telegram-channel digest items are skipped
 * (legacy email-only behavior preserved). Locale is derived from each batch's
 * first notification's `payload.locale` field with `'en'` fallback.
 */
export interface DigestOptions {
  telegramConfig?: TelegramConfig;
}

export async function processDigestQueue(
  db: Database,
  emailConfig: EmailConfig,
  options: DigestOptions = {},
): Promise<number> {
  // 1. Query due items joined with notifications
  const rows = await db
    .select({
      queueId: digestQueue.id,
      tenantId: digestQueue.tenantId,
      userId: digestQueue.userId,
      notificationId: digestQueue.notificationId,
      ruleId: notifications.ruleId,
      eventType: notifications.eventType,
      channel: notifications.channel,
      payload: notifications.payload,
    })
    .from(digestQueue)
    .innerJoin(notifications, eq(digestQueue.notificationId, notifications.id))
    .where(
      and(
        lte(digestQueue.scheduledFor, sql`now()`),
        eq(digestQueue.sent, false),
      ),
    );

  if (rows.length === 0) return 0;

  // 2. Group by tenantId + userId + channel (Phase 7 7b — per-channel digests)
  const groups = new Map<string, DigestItem[]>();
  for (const row of rows) {
    const key = `${row.tenantId}:${row.userId}:${row.channel}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  let digestsSent = 0;

  for (const [, items] of groups) {
    const { tenantId, userId, channel } = items[0];
    const channelEnum = channel as ChannelEnum;

    // 3. Derive locale from the first notification's payload (Phase 7 7b — locale variants).
    // Fall back to 'en' when payload.locale is absent or non-string.
    const locale = pickLocale(items[0].payload);

    // 4. Look up __digest template for this channel + locale. Fall back to 'en'
    // variant if the locale-specific one is missing (matches H9 pipeline lookup chain).
    const digestTmpl = await lookupDigestTemplate(db, tenantId, channelEnum, locale);

    if (!digestTmpl) {
      logger.warn(
        { tenantId, channel, locale },
        'no __digest template for channel/locale — skipping batch',
      );
      await markQueueSent(db, items.map((i) => i.queueId));
      continue;
    }

    // 5. Look up user delivery address for this channel
    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(and(eq(userPreferences.tenantId, tenantId), eq(userPreferences.userId, userId)));

    const recipient = pickRecipient(prefs, channel);
    if (!recipient) {
      logger.warn({ tenantId, userId, channel }, 'no recipient address for digest user — skipping');
      await markQueueSent(db, items.map((i) => i.queueId));
      continue;
    }

    // 6. Render each child notification (best-effort — per-item failures soft-fall)
    const rendered = await renderChildren(db, items.slice(0, MAX_PER_DIGEST), channel);

    // 7. Compose digest context + render outer template
    const truncated = items.length > MAX_PER_DIGEST;
    const context = {
      notifications: rendered,
      count: items.length,
      truncated,
      remaining_count: truncated ? items.length - MAX_PER_DIGEST : 0,
      locale,
    };

    const digestSubject = digestTmpl.subject
      ? renderTemplate(digestTmpl.subject, context)
      : `Your digest (${items.length} notifications)`;
    const digestBody = renderTemplate(digestTmpl.body, context);

    // 8. Dispatch via the channel-appropriate handler
    const result = await dispatchDigest(channel, recipient, digestSubject, digestBody, emailConfig, options);

    if (result.success) {
      digestsSent++;
      logger.info({ tenantId, userId, channel, locale, count: items.length }, 'digest sent');
    } else if (result.skipped) {
      logger.info({ tenantId, userId, channel, reason: result.error }, 'digest skipped (channel unsupported)');
    } else {
      logger.error({ tenantId, userId, channel, error: result.error }, 'digest send failed');
    }

    // 9. Mark queue entries as sent (even on failure — prevents pile-up)
    await markQueueSent(db, items.map((i) => i.queueId));
  }

  return digestsSent;
}

function pickLocale(payload: Record<string, unknown> | null): string {
  const raw = payload?.locale;
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return 'en';
}

type ChannelEnum = 'email' | 'sms' | 'in_app' | 'telegram';

async function lookupDigestTemplate(
  db: Database,
  tenantId: string,
  channel: ChannelEnum,
  locale: string,
): Promise<{ subject: string | null; body: string } | null> {
  // Try locale-specific first
  const [exact] = await db
    .select({ subject: templates.subject, body: templates.body })
    .from(templates)
    .where(
      and(
        eq(templates.tenantId, tenantId),
        eq(templates.name, '__digest'),
        eq(templates.channel, channel),
        eq(templates.locale, locale),
      ),
    );
  if (exact) return exact;

  // Fall back to 'en' variant for the same channel
  if (locale !== 'en') {
    const [enFallback] = await db
      .select({ subject: templates.subject, body: templates.body })
      .from(templates)
      .where(
        and(
          eq(templates.tenantId, tenantId),
          eq(templates.name, '__digest'),
          eq(templates.channel, channel),
          eq(templates.locale, 'en'),
        ),
      );
    if (enFallback) return enFallback;
  }

  return null;
}

function pickRecipient(
  prefs: typeof userPreferences.$inferSelect | undefined,
  channel: string,
): string | null {
  if (!prefs) return null;
  switch (channel) {
    case 'email':
      return prefs.email ?? null;
    case 'telegram':
      return prefs.telegramChatId ?? null;
    default:
      // sms / in_app intentionally unsupported for digests in 7b scope.
      // sms is a stub channel; in_app uses live WebSocket which doesn't
      // fit the "batch-and-send" digest model. Future work.
      return null;
  }
}

async function renderChildren(
  db: Database,
  items: DigestItem[],
  digestChannel: string,
): Promise<{ subject: string | null; body: string; event_type: string; channel: string; created_at: string }[]> {
  const out: { subject: string | null; body: string; event_type: string; channel: string; created_at: string }[] = [];
  for (const item of items) {
    if (!item.ruleId || !item.payload) {
      out.push({ subject: null, body: '(no content)', event_type: item.eventType, channel: digestChannel, created_at: new Date().toISOString() });
      continue;
    }

    const [ruleTmpl] = await db
      .select({ subject: templates.subject, body: templates.body })
      .from(notificationRules)
      .innerJoin(templates, eq(notificationRules.templateId, templates.id))
      .where(eq(notificationRules.id, item.ruleId));

    if (!ruleTmpl) {
      out.push({ subject: null, body: '(template missing)', event_type: item.eventType, channel: digestChannel, created_at: new Date().toISOString() });
      continue;
    }

    const { renderedSubject, renderedBody } = renderSubjectAndBody(
      ruleTmpl.subject, ruleTmpl.body, item.payload,
    );
    out.push({
      subject: renderedSubject,
      body: renderedBody,
      event_type: item.eventType,
      channel: digestChannel,
      created_at: new Date().toISOString(),
    });
  }
  return out;
}

async function dispatchDigest(
  channel: string,
  recipient: string,
  subject: string,
  body: string,
  emailConfig: EmailConfig,
  options: DigestOptions,
): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  if (channel === 'email') {
    const result = await sendEmail(recipient, subject, body, emailConfig);
    return { success: result.success, error: result.error };
  }
  if (channel === 'telegram') {
    if (!options.telegramConfig) {
      return { success: false, skipped: true, error: 'no telegramConfig provided to processDigestQueue' };
    }
    const result = await sendTelegram(recipient, subject, body, options.telegramConfig);
    return { success: result.success, error: result.error };
  }
  // sms / in_app — out of scope for 7b digest improvements
  return { success: false, skipped: true, error: `digest channel "${channel}" unsupported` };
}

async function markQueueSent(db: Database, queueIds: string[]): Promise<void> {
  for (const id of queueIds) {
    await db
      .update(digestQueue)
      .set({ sent: true })
      .where(eq(digestQueue.id, id));
  }
}
