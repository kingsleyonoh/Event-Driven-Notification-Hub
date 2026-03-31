import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, sql } from '../test/setup.js';
import { createTestTenant, createTestNotification, cleanupTestData } from '../test/factories.js';
import { isDuplicate } from './deduplicator.js';

let tenant: Awaited<ReturnType<typeof createTestTenant>>;

beforeAll(async () => {
  tenant = await createTestTenant(db);
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

describe('isDuplicate', () => {
  it('returns false when no prior notification exists', async () => {
    const result = await isDuplicate(db, tenant.id, 'unique-evt', 'user@test.com', 'email', 60);
    expect(result).toBe(false);
  });

  it('returns true when same key exists within window', async () => {
    await createTestNotification(db, {
      tenantId: tenant.id,
      eventType: 'order.completed',
      eventId: 'evt-dup-1',
      recipient: 'dup@test.com',
      channel: 'email',
      status: 'sent',
    });

    const result = await isDuplicate(db, tenant.id, 'evt-dup-1', 'dup@test.com', 'email', 60);
    expect(result).toBe(true);
  });

  it('returns true even when prior notification has status held', async () => {
    await createTestNotification(db, {
      tenantId: tenant.id,
      eventType: 'order.completed',
      eventId: 'evt-held-1',
      recipient: 'held@test.com',
      channel: 'email',
      status: 'held',
    });

    const result = await isDuplicate(db, tenant.id, 'evt-held-1', 'held@test.com', 'email', 60);
    expect(result).toBe(true);
  });

  it('returns true even when prior notification has status queued_digest', async () => {
    await createTestNotification(db, {
      tenantId: tenant.id,
      eventType: 'order.completed',
      eventId: 'evt-digest-1',
      recipient: 'digest@test.com',
      channel: 'email',
      status: 'queued_digest',
    });

    const result = await isDuplicate(db, tenant.id, 'evt-digest-1', 'digest@test.com', 'email', 60);
    expect(result).toBe(true);
  });

  it('returns false for different channel', async () => {
    await createTestNotification(db, {
      tenantId: tenant.id,
      eventType: 'order.completed',
      eventId: 'evt-chan-1',
      recipient: 'chan@test.com',
      channel: 'email',
      status: 'sent',
    });

    const result = await isDuplicate(db, tenant.id, 'evt-chan-1', 'chan@test.com', 'sms', 60);
    expect(result).toBe(false);
  });

  it('returns false for different recipient', async () => {
    await createTestNotification(db, {
      tenantId: tenant.id,
      eventType: 'order.completed',
      eventId: 'evt-recip-1',
      recipient: 'a@test.com',
      channel: 'email',
      status: 'sent',
    });

    const result = await isDuplicate(db, tenant.id, 'evt-recip-1', 'b@test.com', 'email', 60);
    expect(result).toBe(false);
  });
});
