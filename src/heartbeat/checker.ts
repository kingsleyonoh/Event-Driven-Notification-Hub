import { eq, and, lt, isNull, or, sql } from 'drizzle-orm';
import { heartbeats } from '../db/schema.js';
import { publishEvent } from '../consumer/producer.js';
import { createLogger } from '../lib/logger.js';
import type { Database } from '../db/client.js';

const logger = createLogger('heartbeat-checker');

export async function checkStaleHeartbeats(
  db: Database,
  kafkaBrokers: string[],
): Promise<number> {
  // Find heartbeats where:
  //   enabled = true
  //   last_seen_at IS NOT NULL
  //   last_seen_at + interval_minutes < now()  (overdue)
  //   AND (alerted_at IS NULL OR alerted_at < last_seen_at)  (not already alerted for this absence)
  const stale = await db
    .select()
    .from(heartbeats)
    .where(
      and(
        eq(heartbeats.enabled, true),
        sql`${heartbeats.lastSeenAt} IS NOT NULL`,
        sql`${heartbeats.lastSeenAt} + (${heartbeats.intervalMinutes} || ' minutes')::interval < now()`,
        or(
          isNull(heartbeats.alertedAt),
          sql`${heartbeats.alertedAt} < ${heartbeats.lastSeenAt}`,
        ),
      ),
    );

  for (const hb of stale) {
    const eventId = `hb-stale-${hb.id}-${Date.now()}`;

    await publishEvent(kafkaBrokers, 'events.notifications', eventId, {
      tenant_id: hb.tenantId,
      event_type: 'heartbeat.stale',
      event_id: eventId,
      payload: {
        source_name: hb.sourceName,
        last_seen_at: hb.lastSeenAt?.toISOString(),
        interval_minutes: hb.intervalMinutes,
      },
      timestamp: new Date().toISOString(),
    });

    await db
      .update(heartbeats)
      .set({ alertedAt: new Date() })
      .where(eq(heartbeats.id, hb.id));

    logger.info({ sourceName: hb.sourceName, tenantId: hb.tenantId }, 'stale heartbeat detected');
  }

  return stale.length;
}
