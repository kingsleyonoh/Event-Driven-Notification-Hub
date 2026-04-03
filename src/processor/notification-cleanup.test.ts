import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import { createTestTenant, createTestTemplate, createTestRule, createTestNotification, cleanupTestData } from '../test/factories.js';
import { notifications } from '../db/schema.js';
import { cleanupOldNotifications } from './notification-cleanup.js';

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let template: Awaited<ReturnType<typeof createTestTemplate>>;
let rule: Awaited<ReturnType<typeof createTestRule>>;

beforeAll(async () => {
  tenant = await createTestTenant(db);
  template = await createTestTemplate(db, tenant.id);
  rule = await createTestRule(db, tenant.id, template.id);
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

beforeEach(async () => {
  await db.delete(notifications).where(eq(notifications.tenantId, tenant.id));
});

describe('cleanupOldNotifications', () => {
  it('deletes notifications older than retention days', async () => {
    // Old notification — 100 days ago
    await createTestNotification(db, {
      tenantId: tenant.id,
      ruleId: rule.id,
      eventType: 'old.event',
      eventId: `old-${Date.now()}`,
      recipient: 'user',
      channel: 'email',
      status: 'sent',
      createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
    });

    // Recent notification — today
    await createTestNotification(db, {
      tenantId: tenant.id,
      ruleId: rule.id,
      eventType: 'new.event',
      eventId: `new-${Date.now()}`,
      recipient: 'user',
      channel: 'email',
      status: 'sent',
    });

    const deleted = await cleanupOldNotifications(db, 90);

    expect(deleted).toBe(1);

    // Recent one should remain
    const remaining = await db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, tenant.id));
    expect(remaining.length).toBe(1);
    expect(remaining[0].eventType).toBe('new.event');
  });

  it('preserves all records when none are old enough', async () => {
    await createTestNotification(db, {
      tenantId: tenant.id,
      ruleId: rule.id,
      eventType: 'recent.event',
      eventId: `recent-${Date.now()}`,
      recipient: 'user',
      channel: 'email',
      status: 'sent',
    });

    const deleted = await cleanupOldNotifications(db, 90);

    expect(deleted).toBe(0);
  });

  it('respects custom retention days', async () => {
    // 10 days old
    await createTestNotification(db, {
      tenantId: tenant.id,
      ruleId: rule.id,
      eventType: 'mid.event',
      eventId: `mid-${Date.now()}`,
      recipient: 'user',
      channel: 'email',
      status: 'sent',
      createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
    });

    // With 7-day retention, it should be deleted
    const deleted = await cleanupOldNotifications(db, 7);
    expect(deleted).toBe(1);
  });
});
