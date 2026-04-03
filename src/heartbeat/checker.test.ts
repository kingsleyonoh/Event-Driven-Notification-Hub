import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import { createTestTenant, cleanupTestData } from '../test/factories.js';
import { heartbeats } from '../db/schema.js';
import { checkStaleHeartbeats } from './checker.js';

// Mock the Kafka producer — external dependency (broker may not be running in tests)
vi.mock('../consumer/producer.js', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
}));

let tenant: Awaited<ReturnType<typeof createTestTenant>>;

beforeAll(async () => {
  tenant = await createTestTenant(db);
});

afterAll(async () => {
  await db.delete(heartbeats).where(eq(heartbeats.tenantId, tenant.id));
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

beforeEach(async () => {
  await db.delete(heartbeats).where(eq(heartbeats.tenantId, tenant.id));
  vi.clearAllMocks();
});

async function insertHeartbeat(overrides: Partial<typeof heartbeats.$inferInsert> = {}) {
  const [hb] = await db
    .insert(heartbeats)
    .values({
      tenantId: tenant.id,
      sourceName: `test-source-${Date.now()}`,
      intervalMinutes: 60,
      lastSeenAt: new Date(Date.now() - 120 * 60_000), // 2 hours ago (stale for 60min interval)
      ...overrides,
    })
    .returning();
  return hb;
}

describe('checkStaleHeartbeats', () => {
  it('detects stale heartbeat and publishes event', async () => {
    const { publishEvent } = await import('../consumer/producer.js');
    const hb = await insertHeartbeat();

    const count = await checkStaleHeartbeats(db, ['localhost:19092']);

    expect(count).toBe(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);
    expect(publishEvent).toHaveBeenCalledWith(
      ['localhost:19092'],
      'events.notifications',
      expect.stringContaining('hb-stale'),
      expect.objectContaining({
        tenant_id: tenant.id,
        event_type: 'heartbeat.stale',
        payload: expect.objectContaining({
          source_name: hb.sourceName,
        }),
      }),
    );

    // alertedAt should now be set
    const [updated] = await db
      .select()
      .from(heartbeats)
      .where(eq(heartbeats.id, hb.id));
    expect(updated.alertedAt).not.toBeNull();
  });

  it('skips heartbeat that is not yet stale', async () => {
    const { publishEvent } = await import('../consumer/producer.js');
    await insertHeartbeat({
      lastSeenAt: new Date(), // just now — not stale
    });

    const count = await checkStaleHeartbeats(db, ['localhost:19092']);

    expect(count).toBe(0);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('skips heartbeat already alerted (no re-alert until new pulse)', async () => {
    const { publishEvent } = await import('../consumer/producer.js');
    const twoHoursAgo = new Date(Date.now() - 120 * 60_000);
    await insertHeartbeat({
      lastSeenAt: twoHoursAgo,
      alertedAt: new Date(twoHoursAgo.getTime() + 60_000), // alerted AFTER last_seen_at
    });

    const count = await checkStaleHeartbeats(db, ['localhost:19092']);

    expect(count).toBe(0);
    expect(publishEvent).not.toHaveBeenCalled();
  });

  it('re-alerts after new pulse clears alertedAt', async () => {
    const { publishEvent } = await import('../consumer/producer.js');
    // Simulate: was alerted, then pulsed (alertedAt cleared), then went stale again
    await insertHeartbeat({
      lastSeenAt: new Date(Date.now() - 120 * 60_000), // stale
      alertedAt: null, // cleared by a recent pulse
    });

    const count = await checkStaleHeartbeats(db, ['localhost:19092']);

    expect(count).toBe(1);
    expect(publishEvent).toHaveBeenCalledTimes(1);
  });
});
