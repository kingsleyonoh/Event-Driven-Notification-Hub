import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import {
  createTestTenant, createTestTemplate, createTestRule,
  createTestPreferences, cleanupTestData,
} from '../test/factories.js';
import { notifications } from '../db/schema.js';
import { matchRules, resolveRecipient } from './router.js';
import { processNotification } from '../processor/pipeline.js';
import type { KafkaEvent } from './kafka.js';

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

let tenantA: Awaited<ReturnType<typeof createTestTenant>>;
let tenantB: Awaited<ReturnType<typeof createTestTenant>>;

beforeAll(async () => {
  tenantA = await createTestTenant(db);
  tenantB = await createTestTenant(db);

  // Tenant A: rule for order.completed → email to static address
  const tmplA = await createTestTemplate(db, tenantA.id, {
    subject: 'Order {{order_id}}',
    body: 'Your order {{order_id}} is complete',
  });
  await createTestRule(db, tenantA.id, tmplA.id, {
    eventType: 'order.completed',
    channel: 'email',
    recipientType: 'static',
    recipientValue: 'admin@tenanta.com',
  });

  // Tenant B: different rule for the SAME event type
  const tmplB = await createTestTemplate(db, tenantB.id, {
    subject: 'B Order {{order_id}}',
    body: 'Tenant B order {{order_id}}',
  });
  await createTestRule(db, tenantB.id, tmplB.id, {
    eventType: 'order.completed',
    channel: 'email',
    recipientType: 'static',
    recipientValue: 'admin@tenantb.com',
  });
});

afterAll(async () => {
  await cleanupTestData(db, tenantA.id);
  await cleanupTestData(db, tenantB.id);
  await sql.end();
});

const pipelineConfig = { dedupWindowMinutes: 60, digestSchedule: 'daily' as const };

describe('End-to-end: Event → Notification Pipeline', () => {
  it('event consumed → notification created with correct tenant_id', async () => {
    const event: KafkaEvent = {
      tenant_id: tenantA.id,
      event_type: 'order.completed',
      event_id: `e2e-${Date.now()}-1`,
      payload: { order_id: 'ORD-123' },
      timestamp: new Date().toISOString(),
    };

    const rules = await matchRules(db, event.tenant_id, event.event_type);
    expect(rules.length).toBe(1);

    const recipient = resolveRecipient(rules[0].recipientType, rules[0].recipientValue, event.payload);
    expect(recipient).toBe('admin@tenanta.com');

    await processNotification(db, event, rules[0], recipient!, pipelineConfig);

    // Verify notification was created for tenant A
    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif).toBeDefined();
    expect(notif.tenantId).toBe(tenantA.id);
    expect(notif.recipient).toBe('admin@tenanta.com');
    expect(notif.status).toBe('sent');
    expect(notif.subject).toContain('ORD-123');
  });

  it('tenant isolation — tenant A event does not trigger tenant B rules', async () => {
    const event: KafkaEvent = {
      tenant_id: tenantA.id,
      event_type: 'order.completed',
      event_id: `e2e-iso-${Date.now()}`,
      payload: { order_id: 'ORD-456' },
      timestamp: new Date().toISOString(),
    };

    // Match rules for tenant A only
    const rulesA = await matchRules(db, tenantA.id, event.event_type);
    const rulesB = await matchRules(db, tenantB.id, event.event_type);

    // Tenant A should have its rule
    expect(rulesA.length).toBe(1);
    expect(rulesA[0].recipientValue).toBe('admin@tenanta.com');

    // Tenant B should have its OWN rule, not tenant A's
    expect(rulesB.length).toBe(1);
    expect(rulesB[0].recipientValue).toBe('admin@tenantb.com');

    // Process only tenant A's event — no tenant B notification should exist
    await processNotification(db, event, rulesA[0], 'admin@tenanta.com', pipelineConfig);

    const allNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(allNotifs.length).toBe(1);
    expect(allNotifs[0].tenantId).toBe(tenantA.id);
  });

  it('event → email sent via Resend (mocked)', async () => {
    const { sendEmail } = await import('../channels/email.js');
    vi.mocked(sendEmail).mockClear();

    const tmpl = await createTestTemplate(db, tenantA.id, {
      subject: 'Resend Test',
      body: 'Email body for {{name}}',
    });
    const rule = await createTestRule(db, tenantA.id, tmpl.id, {
      eventType: 'email.test',
      channel: 'email',
      recipientType: 'static',
      recipientValue: 'resend-test@example.com',
    });

    const event: KafkaEvent = {
      tenant_id: tenantA.id,
      event_type: 'email.test',
      event_id: `e2e-email-${Date.now()}`,
      payload: { name: 'TestUser' },
      timestamp: new Date().toISOString(),
    };

    await processNotification(db, event, rule, 'resend-test@example.com', {
      ...pipelineConfig,
      dispatch: { email: { apiKey: 're_test', from: 'noreply@test.com' } },
    });

    expect(sendEmail).toHaveBeenCalledWith(
      'resend-test@example.com',
      'Resend Test',
      'Email body for TestUser',
      { apiKey: 're_test', from: 'noreply@test.com' },
    );
  });

  it('WebSocket reconnect — fetch unread via API', async () => {
    // Create an unread in_app notification
    const tmpl = await createTestTemplate(db, tenantA.id, {
      subject: 'WS Reconnect',
      body: 'Missed notification',
    });
    const rule = await createTestRule(db, tenantA.id, tmpl.id, {
      eventType: 'ws.reconnect.test',
      channel: 'in_app',
      recipientType: 'static',
      recipientValue: 'reconnect-user',
    });

    const event: KafkaEvent = {
      tenant_id: tenantA.id,
      event_type: 'ws.reconnect.test',
      event_id: `e2e-ws-${Date.now()}`,
      payload: {},
      timestamp: new Date().toISOString(),
    };

    await processNotification(db, event, rule, 'reconnect-user', pipelineConfig);

    // Verify the notification exists and is unread (sent, no deliveredAt)
    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif.status).toBe('sent');
    expect(notif.channel).toBe('in_app');
    expect(notif.deliveredAt).toBeNull();
    // On reconnect, client would call GET /api/notifications/:userId/unread — already tested in notifications.routes.test.ts
  });
});
