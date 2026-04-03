import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import {
  createTestTenant, createTestTemplate, createTestRule,
  createTestPreferences, createTestNotification, cleanupTestData,
} from '../test/factories.js';
import { notifications } from '../db/schema.js';
import { releaseHeldNotifications } from './quiet-hours-release.js';

// Mock email — third-party API
vi.mock('../channels/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../channels/sms.js', () => ({
  sendSms: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../channels/in-app.js', () => ({
  sendInApp: vi.fn().mockResolvedValue({ success: true }),
}));

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let template: Awaited<ReturnType<typeof createTestTemplate>>;
let rule: Awaited<ReturnType<typeof createTestRule>>;

const dispatchConfig = { email: { apiKey: 're_test', from: 'test@test.com' } };

beforeAll(async () => {
  tenant = await createTestTenant(db);
  template = await createTestTemplate(db, tenant.id, {
    subject: 'Hello {{name}}',
    body: 'Message: {{text}}',
  });
  rule = await createTestRule(db, tenant.id, template.id, {
    recipientType: 'static',
    recipientValue: 'user@test.com',
  });
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

beforeEach(async () => {
  await db.delete(notifications).where(eq(notifications.tenantId, tenant.id));
  vi.clearAllMocks();
});

describe('releaseHeldNotifications', () => {
  it('releases held notification when quiet hours have ended', async () => {
    // User with quiet hours that are NOT active now (e.g., 02:00-04:00 UTC and it's daytime)
    await createTestPreferences(db, tenant.id, 'released-user', {
      email: 'released@test.com',
      quietHours: { start: '02:00', end: '04:00', timezone: 'UTC' },
    });

    await createTestNotification(db, {
      tenantId: tenant.id,
      ruleId: rule.id,
      eventType: 'test.event',
      eventId: `held-release-${Date.now()}`,
      recipient: 'released-user',
      channel: 'email',
      status: 'held',
      payload: { name: 'Alice', text: 'hello world' },
    });

    const count = await releaseHeldNotifications(db, dispatchConfig);

    expect(count).toBeGreaterThanOrEqual(1);

    // Notification should be updated to sent
    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, tenant.id));
    expect(notif.status).toBe('sent');
  });

  it('skips notification still in quiet hours', async () => {
    // User with quiet hours that ARE active (00:00-23:59 = always quiet)
    await createTestPreferences(db, tenant.id, 'still-quiet-user', {
      email: 'quiet@test.com',
      quietHours: { start: '00:00', end: '23:59', timezone: 'UTC' },
    });

    await createTestNotification(db, {
      tenantId: tenant.id,
      ruleId: rule.id,
      eventType: 'test.event',
      eventId: `held-still-${Date.now()}`,
      recipient: 'still-quiet-user',
      channel: 'email',
      status: 'held',
      payload: { name: 'Bob', text: 'still quiet' },
    });

    const count = await releaseHeldNotifications(db, dispatchConfig);

    expect(count).toBe(0);

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, tenant.id));
    expect(notif.status).toBe('held');
  });

  it('is idempotent — re-running does not re-dispatch already sent', async () => {
    await createTestPreferences(db, tenant.id, 'idem-user', {
      email: 'idem@test.com',
      quietHours: { start: '02:00', end: '04:00', timezone: 'UTC' },
    });

    await createTestNotification(db, {
      tenantId: tenant.id,
      ruleId: rule.id,
      eventType: 'test.event',
      eventId: `held-idem-${Date.now()}`,
      recipient: 'idem-user',
      channel: 'email',
      status: 'held',
      payload: { name: 'Carol', text: 'idempotent' },
    });

    await releaseHeldNotifications(db, dispatchConfig);
    const count2 = await releaseHeldNotifications(db, dispatchConfig);

    expect(count2).toBe(0); // nothing to release on second run
  });
});
