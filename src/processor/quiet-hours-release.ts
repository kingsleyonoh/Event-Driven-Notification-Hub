import { eq, and } from 'drizzle-orm';
import { notifications, notificationRules, templates, userPreferences } from '../db/schema.js';
import { isWithinQuietHours } from './preferences.js';
import { renderSubjectAndBody } from '../templates/renderer.js';
import { dispatch, type DispatchConfig } from '../channels/dispatcher.js';
import { createLogger } from '../lib/logger.js';
import type { Database } from '../db/client.js';

const logger = createLogger('quiet-hours-release');

export async function releaseHeldNotifications(
  db: Database,
  dispatchConfig?: DispatchConfig,
): Promise<number> {
  // 1. Query all held notifications
  const held = await db
    .select()
    .from(notifications)
    .where(eq(notifications.status, 'held'));

  if (held.length === 0) return 0;

  let released = 0;

  for (const notif of held) {
    // 2. Look up user's quiet hours
    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.tenantId, notif.tenantId),
          eq(userPreferences.userId, notif.recipient),
        ),
      );

    // If still in quiet hours, skip
    if (prefs && isWithinQuietHours(prefs.quietHours)) {
      continue;
    }

    // 3. Look up rule's template to re-render
    if (!notif.ruleId || !notif.payload) {
      await db
        .update(notifications)
        .set({ status: 'failed', errorMessage: 'missing rule or payload for re-render' })
        .where(eq(notifications.id, notif.id));
      continue;
    }

    const [ruleTmpl] = await db
      .select({ subject: templates.subject, body: templates.body })
      .from(notificationRules)
      .innerJoin(templates, eq(notificationRules.templateId, templates.id))
      .where(eq(notificationRules.id, notif.ruleId));

    if (!ruleTmpl) {
      await db
        .update(notifications)
        .set({ status: 'failed', errorMessage: 'template not found for re-render' })
        .where(eq(notifications.id, notif.id));
      continue;
    }

    // 4. Re-render
    const { renderedSubject, renderedBody } = renderSubjectAndBody(
      ruleTmpl.subject, ruleTmpl.body, notif.payload as Record<string, unknown>,
    );

    // 5. Resolve delivery address
    let address = notif.recipient;
    if (prefs) {
      if (notif.channel === 'email' && prefs.email) address = prefs.email;
      else if (notif.channel === 'sms' && prefs.phone) address = prefs.phone;
    }

    // 6. Dispatch
    const result = await dispatch(notif.channel, address, renderedSubject, renderedBody, {
      tenantId: notif.tenantId,
      notificationId: notif.id,
      eventType: notif.eventType,
    }, dispatchConfig);

    if (result.success) {
      await db
        .update(notifications)
        .set({ status: 'sent', deliveredAt: new Date(), subject: renderedSubject, bodyPreview: renderedBody.slice(0, 500) })
        .where(eq(notifications.id, notif.id));
      released++;
    } else {
      await db
        .update(notifications)
        .set({ status: 'failed', errorMessage: result.error ?? 'dispatch failed' })
        .where(eq(notifications.id, notif.id));
    }

    logger.info({ notificationId: notif.id, recipient: notif.recipient, channel: notif.channel }, 'released held notification');
  }

  return released;
}
