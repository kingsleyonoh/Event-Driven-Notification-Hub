import { eq, and, lte, sql } from 'drizzle-orm';
import { digestQueue, notifications, templates, notificationRules, userPreferences } from '../db/schema.js';
import { renderSubjectAndBody, renderTemplate } from '../templates/renderer.js';
import { sendEmail, type EmailConfig } from '../channels/email.js';
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
  payload: Record<string, unknown> | null;
}

export async function processDigestQueue(
  db: Database,
  emailConfig: EmailConfig,
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

  // 2. Group by tenantId + userId
  const groups = new Map<string, DigestItem[]>();
  for (const row of rows) {
    const key = `${row.tenantId}:${row.userId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  let digestsSent = 0;

  for (const [, items] of groups) {
    const { tenantId, userId } = items[0];

    // 3. Look up __digest template
    const [digestTmpl] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.tenantId, tenantId), eq(templates.name, '__digest')));

    if (!digestTmpl) {
      logger.warn({ tenantId }, 'no __digest template — skipping batch');
      await markQueueSent(db, items.map((i) => i.queueId));
      continue;
    }

    // 4. Look up user email
    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(and(eq(userPreferences.tenantId, tenantId), eq(userPreferences.userId, userId)));

    if (!prefs?.email) {
      logger.warn({ tenantId, userId }, 'no email for digest user — skipping');
      await markQueueSent(db, items.map((i) => i.queueId));
      continue;
    }

    // 5. Render each notification individually
    const rendered: { subject: string | null; body: string; event_type: string; channel: string; created_at: string }[] = [];
    const toRender = items.slice(0, MAX_PER_DIGEST);

    for (const item of toRender) {
      if (!item.ruleId || !item.payload) {
        rendered.push({ subject: null, body: '(no content)', event_type: item.eventType, channel: 'email', created_at: new Date().toISOString() });
        continue;
      }

      const [ruleTmpl] = await db
        .select({ subject: templates.subject, body: templates.body })
        .from(notificationRules)
        .innerJoin(templates, eq(notificationRules.templateId, templates.id))
        .where(eq(notificationRules.id, item.ruleId));

      if (!ruleTmpl) {
        rendered.push({ subject: null, body: '(template missing)', event_type: item.eventType, channel: 'email', created_at: new Date().toISOString() });
        continue;
      }

      const { renderedSubject, renderedBody } = renderSubjectAndBody(
        ruleTmpl.subject, ruleTmpl.body, item.payload,
      );
      rendered.push({
        subject: renderedSubject,
        body: renderedBody,
        event_type: item.eventType,
        channel: 'email',
        created_at: new Date().toISOString(),
      });
    }

    // 6. Compose digest context
    const truncated = items.length > MAX_PER_DIGEST;
    const context = {
      notifications: rendered,
      count: items.length,
      truncated,
      remaining_count: truncated ? items.length - MAX_PER_DIGEST : 0,
    };

    // 7. Render digest template
    const digestSubject = digestTmpl.subject
      ? renderTemplate(digestTmpl.subject, context)
      : `Your digest (${items.length} notifications)`;
    const digestBody = renderTemplate(digestTmpl.body, context);

    // 8. Send
    const result = await sendEmail(prefs.email, digestSubject, digestBody, emailConfig);

    if (result.success) {
      digestsSent++;
      logger.info({ tenantId, userId, count: items.length }, 'digest sent');
    } else {
      logger.error({ tenantId, userId, error: result.error }, 'digest send failed');
    }

    // 9. Mark all queue entries as sent (even on failure — prevents pile-up)
    await markQueueSent(db, items.map((i) => i.queueId));
  }

  return digestsSent;
}

async function markQueueSent(db: Database, queueIds: string[]): Promise<void> {
  for (const id of queueIds) {
    await db
      .update(digestQueue)
      .set({ sent: true })
      .where(eq(digestQueue.id, id));
  }
}
