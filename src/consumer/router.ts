import { eq, and } from 'drizzle-orm';
import { notificationRules } from '../db/schema.js';
import { createLogger } from '../lib/logger.js';
import type { Database } from '../db/client.js';

const logger = createLogger('router');

export async function matchRules(db: Database, tenantId: string, eventType: string) {
  return db
    .select()
    .from(notificationRules)
    .where(
      and(
        eq(notificationRules.tenantId, tenantId),
        eq(notificationRules.eventType, eventType),
        eq(notificationRules.enabled, true),
      ),
    );
}

export function resolveRecipient(
  recipientType: string,
  recipientValue: string,
  payload: Record<string, unknown>,
): string | null {
  switch (recipientType) {
    case 'static':
      return recipientValue;

    case 'event_field': {
      const parts = recipientValue.split('.');
      let current: unknown = payload;
      for (const part of parts) {
        if (current == null || typeof current !== 'object') return null;
        current = (current as Record<string, unknown>)[part];
      }
      return typeof current === 'string' ? current : null;
    }

    case 'role':
      logger.warn({ recipientValue }, 'role-based routing not implemented — skipping');
      return null;

    default:
      logger.error({ recipientType }, 'unknown recipient type');
      return null;
  }
}
