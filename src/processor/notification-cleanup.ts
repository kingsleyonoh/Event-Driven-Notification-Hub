import { lt, sql } from 'drizzle-orm';
import { notifications, digestQueue } from '../db/schema.js';
import { createLogger } from '../lib/logger.js';
import type { Database } from '../db/client.js';

const logger = createLogger('notification-cleanup');

export async function cleanupOldNotifications(
  db: Database,
  retentionDays: number,
): Promise<number> {
  const cutoff = sql`now() - (${retentionDays} || ' days')::interval`;

  // Delete digest_queue entries first (FK → notifications)
  await db
    .delete(digestQueue)
    .where(lt(digestQueue.createdAt, cutoff));

  // Delete old notifications
  const deleted = await db
    .delete(notifications)
    .where(lt(notifications.createdAt, cutoff))
    .returning({ id: notifications.id });

  if (deleted.length > 0) {
    logger.info({ count: deleted.length, retentionDays }, 'cleaned up old notifications');
  }

  return deleted.length;
}
