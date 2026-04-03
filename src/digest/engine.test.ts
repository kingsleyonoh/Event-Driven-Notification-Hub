import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import {
  createTestTenant, createTestTemplate, createTestRule,
  createTestPreferences, createTestNotification, cleanupTestData,
} from '../test/factories.js';
import { digestQueue, notifications } from '../db/schema.js';
import { processDigestQueue } from './engine.js';

// Mock email — third-party API (Resend)
vi.mock('../channels/email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let digestTemplate: Awaited<ReturnType<typeof createTestTemplate>>;
let ruleTemplate: Awaited<ReturnType<typeof createTestTemplate>>;
let rule: Awaited<ReturnType<typeof createTestRule>>;

const emailConfig = { apiKey: 're_test', from: 'digest@test.com' };

beforeAll(async () => {
  tenant = await createTestTenant(db);

  // __digest template for the tenant
  digestTemplate = await createTestTemplate(db, tenant.id, {
    name: '__digest',
    channel: 'email',
    subject: 'Your digest ({{count}} notifications)',
    body: '{{#each notifications}}<p>{{this.subject}}: {{this.body}}</p>{{/each}}{{#if truncated}}<p>And {{remaining_count}} more...</p>{{/if}}',
  });

  // Rule template for individual notifications
  ruleTemplate = await createTestTemplate(db, tenant.id, {
    name: 'event-template',
    channel: 'email',
    subject: '{{title}}',
    body: 'Hello {{name}}, {{message}}',
  });

  rule = await createTestRule(db, tenant.id, ruleTemplate.id, {
    eventType: 'digest.test',
    recipientType: 'event_field',
    recipientValue: 'user_id',
  });
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

beforeEach(async () => {
  await db.delete(digestQueue).where(eq(digestQueue.tenantId, tenant.id));
  await db.delete(notifications).where(eq(notifications.tenantId, tenant.id));
  vi.clearAllMocks();
});

async function seedDigestItem(userId: string, payload: Record<string, unknown>, scheduledFor?: Date) {
  // Create preferences so the engine can find the user's email
  try {
    await createTestPreferences(db, tenant.id, userId, { email: `${userId}@test.com` });
  } catch {
    // Already exists — ignore unique constraint
  }

  const notif = await createTestNotification(db, {
    tenantId: tenant.id,
    ruleId: rule.id,
    eventType: 'digest.test',
    eventId: `digest-evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    recipient: userId,
    channel: 'email',
    status: 'queued_digest',
    payload,
  });

  await db.insert(digestQueue).values({
    tenantId: tenant.id,
    userId,
    notificationId: notif.id,
    scheduledFor: scheduledFor ?? new Date(Date.now() - 60_000), // 1 min ago = due
  });

  return notif;
}

describe('processDigestQueue', () => {
  it('processes due items, sends digest email, marks sent', async () => {
    const { sendEmail } = await import('../channels/email.js');
    await seedDigestItem('digest-user-1', { title: 'Alert', name: 'Alice', message: 'thing happened' });
    await seedDigestItem('digest-user-1', { title: 'Update', name: 'Alice', message: 'another thing' });

    const count = await processDigestQueue(db, emailConfig);

    expect(count).toBe(1); // 1 user = 1 digest
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      'digest-user-1@test.com',
      expect.stringContaining('2 notifications'),
      expect.stringContaining('Alert'),
      emailConfig,
    );

    // Verify queue entries are marked sent
    const remaining = await db
      .select()
      .from(digestQueue)
      .where(eq(digestQueue.tenantId, tenant.id));
    expect(remaining.every((r) => r.sent === true)).toBe(true);
  });

  it('returns 0 when queue is empty', async () => {
    const { sendEmail } = await import('../channels/email.js');

    const count = await processDigestQueue(db, emailConfig);

    expect(count).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips tenant with missing __digest template — marks entries sent', async () => {
    const { sendEmail } = await import('../channels/email.js');
    const tenantNoDigest = await createTestTenant(db);
    const tmpl = await createTestTemplate(db, tenantNoDigest.id);
    const r = await createTestRule(db, tenantNoDigest.id, tmpl.id);
    await createTestPreferences(db, tenantNoDigest.id, 'orphan-user', { email: 'orphan@test.com' });

    const notif = await createTestNotification(db, {
      tenantId: tenantNoDigest.id,
      ruleId: r.id,
      eventType: 'test.event',
      eventId: `no-digest-tmpl-${Date.now()}`,
      recipient: 'orphan-user',
      channel: 'email',
      status: 'queued_digest',
      payload: { foo: 'bar' },
    });
    await db.insert(digestQueue).values({
      tenantId: tenantNoDigest.id,
      userId: 'orphan-user',
      notificationId: notif.id,
      scheduledFor: new Date(Date.now() - 60_000),
    });

    const count = await processDigestQueue(db, emailConfig);

    expect(count).toBe(0); // skipped, no email sent
    expect(sendEmail).not.toHaveBeenCalled();

    // But entries should be marked sent to prevent pile-up
    const entries = await db
      .select()
      .from(digestQueue)
      .where(eq(digestQueue.tenantId, tenantNoDigest.id));
    expect(entries.every((e) => e.sent === true)).toBe(true);

    await cleanupTestData(db, tenantNoDigest.id);
  });

  it('truncates at 50 notifications with remaining_count', async () => {
    const { sendEmail } = await import('../channels/email.js');

    // Seed 55 items
    for (let i = 0; i < 55; i++) {
      await seedDigestItem('bulk-user', { title: `Item ${i}`, name: 'Bulk', message: `msg ${i}` });
    }

    const count = await processDigestQueue(db, emailConfig);

    expect(count).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    // Body should contain truncation message
    const callArgs = vi.mocked(sendEmail).mock.calls[0];
    const body = callArgs[2]; // third arg = body
    expect(body).toContain('And 5 more...');
  });

  it('groups by user — two users get two separate emails', async () => {
    const { sendEmail } = await import('../channels/email.js');
    await seedDigestItem('user-a', { title: 'For A', name: 'A', message: 'msg' });
    await seedDigestItem('user-b', { title: 'For B', name: 'B', message: 'msg' });

    const count = await processDigestQueue(db, emailConfig);

    expect(count).toBe(2);
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });

  it('skips items not yet due', async () => {
    const { sendEmail } = await import('../channels/email.js');
    await seedDigestItem('future-user', { title: 'Future', name: 'X', message: 'y' },
      new Date(Date.now() + 3600_000), // 1 hour from now
    );

    const count = await processDigestQueue(db, emailConfig);

    expect(count).toBe(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('renders each notification from stored payload + rule template', async () => {
    const { sendEmail } = await import('../channels/email.js');
    await seedDigestItem('render-user', { title: 'Deploy', name: 'Bob', message: 'v2.0 is live' });

    await processDigestQueue(db, emailConfig);

    const callArgs = vi.mocked(sendEmail).mock.calls[0];
    const body = callArgs[2];
    // Individual notification should be rendered with the rule template
    expect(body).toContain('Deploy');
    expect(body).toContain('Hello Bob, v2.0 is live');
  });
});
