import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import {
  createTestTenant, createTestTemplate, createTestRule, cleanupTestData,
} from '../test/factories.js';
import { notifications } from '../db/schema.js';
import { processNotification } from './pipeline.js';

// Mock Resend at the package level — captures all email send calls
const mockResendSend = vi.fn();

vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = { send: mockResendSend };
    },
  };
});

let tenant: Awaited<ReturnType<typeof createTestTenant>>;

beforeAll(async () => {
  tenant = await createTestTenant(db, {
    config: {
      channels: {
        email: { apiKey: 're_test', from: 'noreply@test.com' },
      },
    },
  });
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

beforeEach(() => {
  mockResendSend.mockReset();
  mockResendSend.mockResolvedValue({ data: { id: 'msg-headers' }, error: null });
});

describe('processNotification — custom email headers (RFC 8058 List-Unsubscribe)', () => {
  it('renders header value templates with payload context and forwards to Resend', async () => {
    const template = await createTestTemplate(db, tenant.id, {
      subject: 'Hi {{name}}',
      body: 'Hello',
      headers: { 'X-Client-Id': '{{client_id}}' },
    });
    const rule = await createTestRule(db, tenant.id, template.id, {
      eventType: 'test.headers.simple',
      channel: 'email',
      recipientType: 'static',
      recipientValue: 'customer@example.com',
    });

    const event = {
      tenant_id: tenant.id,
      event_type: 'test.headers.simple',
      event_id: `evt-headers-${Date.now()}`,
      payload: { name: 'Alice', client_id: 'abc' },
      timestamp: new Date().toISOString(),
    };

    await processNotification(db, event, rule, 'customer@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: {
        channels: { email: { apiKey: 're_test', from: 'noreply@test.com' } },
      },
    });

    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const sendArgs = mockResendSend.mock.calls[0][0];
    // X-Hub-* correlation headers (notification + tenant id) are added by
    // sendEmail for Resend webhook round-trip — match alongside template headers.
    expect(sendArgs.headers).toMatchObject({ 'X-Client-Id': 'abc' });
    expect(sendArgs.headers['X-Hub-Notification-ID']).toBeTruthy();
    expect(sendArgs.headers['X-Hub-Tenant-ID']).toBe(tenant.id);

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));
    expect(notif.status).toBe('sent');
  });

  it('soft-fails individual headers: if one header value fails to render, omit it but still send other headers + email', async () => {
    const template = await createTestTemplate(db, tenant.id, {
      subject: 'Hi',
      body: 'Hello',
      headers: {
        'X-Good-Header': '{{good_value}}',
        // This will throw at render time because Handlebars partials/helpers aren't registered
        'X-Bad-Header': '{{> nonexistent_partial}}',
      },
    });
    const rule = await createTestRule(db, tenant.id, template.id, {
      eventType: 'test.headers.softfail',
      channel: 'email',
      recipientType: 'static',
      recipientValue: 'customer@example.com',
    });

    const event = {
      tenant_id: tenant.id,
      event_type: 'test.headers.softfail',
      event_id: `evt-soft-${Date.now()}`,
      payload: { good_value: 'works' },
      timestamp: new Date().toISOString(),
    };

    await processNotification(db, event, rule, 'customer@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: {
        channels: { email: { apiKey: 're_test', from: 'noreply@test.com' } },
      },
    });

    // Email IS still sent (no notification.failed)
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const sendArgs = mockResendSend.mock.calls[0][0];
    // Good header survives, bad header omitted; X-Hub-* correlation headers added.
    expect(sendArgs.headers).toMatchObject({ 'X-Good-Header': 'works' });
    expect(sendArgs.headers['X-Bad-Header']).toBeUndefined();
    expect(sendArgs.headers['X-Hub-Notification-ID']).toBeTruthy();
    expect(sendArgs.headers['X-Hub-Tenant-ID']).toBe(tenant.id);

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));
    expect(notif.status).toBe('sent');
  });

  it('end-to-end: List-Unsubscribe + List-Unsubscribe-Post (RFC 8058 Gmail one-click)', async () => {
    const template = await createTestTemplate(db, tenant.id, {
      subject: 'Newsletter',
      body: '<p>Hi</p>',
      headers: {
        'List-Unsubscribe': '<{{unsub_url}}>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    const rule = await createTestRule(db, tenant.id, template.id, {
      eventType: 'test.headers.rfc8058',
      channel: 'email',
      recipientType: 'static',
      recipientValue: 'customer@example.com',
    });

    const event = {
      tenant_id: tenant.id,
      event_type: 'test.headers.rfc8058',
      event_id: `evt-rfc-${Date.now()}`,
      payload: { unsub_url: 'https://x.com/u/abc' },
      timestamp: new Date().toISOString(),
    };

    await processNotification(db, event, rule, 'customer@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: {
        channels: { email: { apiKey: 're_test', from: 'noreply@test.com' } },
      },
    });

    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const sendArgs = mockResendSend.mock.calls[0][0];
    // RFC 8058 headers preserved alongside the X-Hub-* correlation pair.
    expect(sendArgs.headers).toMatchObject({
      'List-Unsubscribe': '<https://x.com/u/abc>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
    expect(sendArgs.headers['X-Hub-Notification-ID']).toBeTruthy();
    expect(sendArgs.headers['X-Hub-Tenant-ID']).toBe(tenant.id);

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));
    expect(notif.status).toBe('sent');
  });
});
