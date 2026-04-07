import { eq, and, gte } from 'drizzle-orm';
import { notifications } from '../db/schema.js';
import type { Database } from '../db/client.js';

export async function isDuplicate(
  db: Database,
  tenantId: string,
  eventId: string,
  recipient: string,
  channel: 'email' | 'sms' | 'in_app' | 'telegram',
  windowMinutes: number,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);

  const [existing] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.eventId, eventId),
        eq(notifications.recipient, recipient),
        eq(notifications.channel, channel),
        gte(notifications.createdAt, windowStart),
      ),
    )
    .limit(1);

  return !!existing;
}
