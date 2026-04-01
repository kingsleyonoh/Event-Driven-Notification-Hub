import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import {
  createTestTenant, createTestTemplate, createTestRule,
  createTestPreferences, cleanupTestData,
} from '../test/factories.js';
import { notifications, digestQueue } from '../db/schema.js';
import { processNotification } from './pipeline.js';

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let template: Awaited<ReturnType<typeof createTestTemplate>>;
let rule: Awaited<ReturnType<typeof createTestRule>>;

beforeAll(async () => {
  tenant = await createTestTenant(db);
  template = await createTestTemplate(db, tenant.id, {
    subject: 'Hello {{name}}',
    body: 'Welcome {{name}}, your order #{{orderId}} is confirmed.',
  });
  rule = await createTestRule(db, tenant.id, template.id, {
    eventType: 'order.completed',
    channel: 'email',
    recipientType: 'static',
    recipientValue: 'test@example.com',
  });
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

function makeEvent(overrides: Partial<{ event_id: string; event_type: string; payload: Record<string, unknown> }> = {}) {
  return {
    tenant_id: tenant.id,
    event_type: overrides.event_type ?? 'order.completed',
    event_id: overrides.event_id ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    payload: overrides.payload ?? { name: 'Alice', orderId: '999' },
    timestamp: new Date().toISOString(),
  };
}

describe('processNotification', () => {
  it('happy path — creates pending notification with rendered content', async () => {
    const event = makeEvent();

    await processNotification(db, event, rule, 'test@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
    });

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif).toBeDefined();
    expect(notif.status).toBe('sent');
    expect(notif.deliveredAt).toBeInstanceOf(Date);
    expect(notif.subject).toBe('Hello Alice');
    expect(notif.bodyPreview).toContain('Welcome Alice');
    expect(notif.recipient).toBe('test@example.com');
  });

  it('opt-out — creates skipped notification', async () => {
    await createTestPreferences(db, tenant.id, 'opted-out-user', {
      email: 'opted@example.com',
      optOut: { email: ['order.completed'] },
    });

    const event = makeEvent();
    const efRule = { ...rule, recipientType: 'event_field', recipientValue: 'userId' };

    await processNotification(
      db,
      { ...event, payload: { ...event.payload, userId: 'opted-out-user' } },
      efRule,
      'opted-out-user',
      { dedupWindowMinutes: 60, digestSchedule: 'daily' },
    );

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif).toBeDefined();
    expect(notif.status).toBe('skipped');
    expect(notif.skipReason).toBe('opt_out');
  });

  it('dedup — creates skipped notification for duplicate event', async () => {
    const eventId = `dedup-${Date.now()}`;
    const event = makeEvent({ event_id: eventId });
    // First call — should succeed
    await processNotification(db, event, rule, 'test@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
    });

    // Second call — same event_id + recipient + channel
    await processNotification(db, event, rule, 'test@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
    });

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, eventId));

    expect(notifs).toHaveLength(2);
    expect(notifs[0].status).toBe('sent');
    expect(notifs[1].status).toBe('skipped');
    expect(notifs[1].skipReason).toBe('deduplicated');
  });

  it('quiet hours + no digest — creates held notification with payload', async () => {
    await createTestPreferences(db, tenant.id, 'quiet-user', {
      email: 'quiet@example.com',
      quietHours: { start: '00:00', end: '23:59', timezone: 'UTC' },
      digestMode: false,
    });

    const event = makeEvent();
    const efRule = { ...rule, recipientType: 'event_field', recipientValue: 'userId' };

    await processNotification(
      db,
      { ...event, payload: { ...event.payload, userId: 'quiet-user' } },
      efRule,
      'quiet-user',
      { dedupWindowMinutes: 60, digestSchedule: 'daily' },
    );

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif.status).toBe('held');
    expect(notif.payload).toBeDefined();
  });

  it('quiet hours + digest mode — creates queued_digest + digest_queue entry', async () => {
    await createTestPreferences(db, tenant.id, 'quiet-digest-user', {
      email: 'qd@example.com',
      quietHours: { start: '00:00', end: '23:59', timezone: 'UTC' },
      digestMode: true,
      digestSchedule: 'hourly',
    });

    const event = makeEvent();
    const efRule = { ...rule, recipientType: 'event_field', recipientValue: 'userId' };

    await processNotification(
      db,
      { ...event, payload: { ...event.payload, userId: 'quiet-digest-user' } },
      efRule,
      'quiet-digest-user',
      { dedupWindowMinutes: 60, digestSchedule: 'daily' },
    );

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif.status).toBe('queued_digest');
    expect(notif.payload).toBeDefined();

    const [dq] = await db
      .select()
      .from(digestQueue)
      .where(eq(digestQueue.notificationId, notif.id));

    expect(dq).toBeDefined();
    expect(dq.userId).toBe('quiet-digest-user');
    expect(dq.scheduledFor).toBeInstanceOf(Date);
  });

  it('digest mode (not quiet hours) — creates queued_digest + digest_queue entry', async () => {
    await createTestPreferences(db, tenant.id, 'digest-only-user', {
      email: 'digest@example.com',
      digestMode: true,
      digestSchedule: 'daily',
    });

    const event = makeEvent();
    const efRule = { ...rule, recipientType: 'event_field', recipientValue: 'userId' };

    await processNotification(
      db,
      { ...event, payload: { ...event.payload, userId: 'digest-only-user' } },
      efRule,
      'digest-only-user',
      { dedupWindowMinutes: 60, digestSchedule: 'daily' },
    );

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif.status).toBe('queued_digest');

    const [dq] = await db
      .select()
      .from(digestQueue)
      .where(eq(digestQueue.notificationId, notif.id));

    expect(dq).toBeDefined();
  });

  it('truncates bodyPreview to 500 chars', async () => {
    const longTemplate = await createTestTemplate(db, tenant.id, {
      name: `long-body-${Date.now()}`,
      subject: 'Long',
      body: 'X'.repeat(1000),
    });

    const event = makeEvent();
    const longRule = { ...rule, templateId: longTemplate.id };

    await processNotification(db, event, longRule, 'test@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
    });

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif.bodyPreview!.length).toBe(500);
  });

  it('updates status to sent with delivered_at on successful dispatch', async () => {
    const event = makeEvent({ event_id: `sent-${Date.now()}` });

    await processNotification(db, event, rule, 'test@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
    });

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif.status).toBe('sent');
    expect(notif.deliveredAt).toBeInstanceOf(Date);
  });

  it('updates status to failed with error_message on dispatch failure', async () => {
    // Import and mock dispatcher to simulate failure
    const dispatcherModule = await import('../channels/dispatcher.js');
    const originalDispatch = dispatcherModule.dispatch;

    // Temporarily replace dispatch with a failing version
    vi.spyOn(dispatcherModule, 'dispatch').mockResolvedValueOnce({
      success: false,
      error: 'Resend API rate limit exceeded',
    });

    const event = makeEvent({ event_id: `fail-${Date.now()}` });

    await processNotification(db, event, rule, 'test@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
    });

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif.status).toBe('failed');
    expect(notif.errorMessage).toBe('Resend API rate limit exceeded');

    // Restore
    vi.restoreAllMocks();
  });

  it('skips when no delivery address found', async () => {
    const event = makeEvent();
    const efRule = { ...rule, recipientType: 'event_field', recipientValue: 'userId' };

    await processNotification(
      db,
      { ...event, payload: { userId: 'nonexistent-user' } },
      efRule,
      'nonexistent-user',
      { dedupWindowMinutes: 60, digestSchedule: 'daily' },
    );

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif.status).toBe('skipped');
    expect(notif.skipReason).toBe('no_delivery_address');
  });
});
