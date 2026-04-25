import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import {
  createTestTenant, createTestTemplate, createTestRule, cleanupTestData,
} from '../test/factories.js';
import { tenants, notifications } from '../db/schema.js';
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
let template: Awaited<ReturnType<typeof createTestTemplate>>;
let rule: Awaited<ReturnType<typeof createTestRule>>;

beforeAll(async () => {
  tenant = await createTestTenant(db, {
    config: {
      channels: {
        email: {
          apiKey: 're_test',
          from: 'noreply@test.com',
          replyTo: 'tenant@x.com',
        },
      },
    },
  });
  template = await createTestTemplate(db, tenant.id, {
    subject: 'Hello {{name}}',
    body: 'Hi {{name}}, this is a test.',
    // No template-level reply_to set — so event-level should win
  });
  rule = await createTestRule(db, tenant.id, template.id, {
    eventType: 'test.replyto',
    channel: 'email',
    recipientType: 'static',
    recipientValue: 'customer@example.com',
  });
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

beforeEach(() => {
  mockResendSend.mockReset();
  mockResendSend.mockResolvedValue({ data: { id: 'msg-replyto' }, error: null });
});

describe('processNotification — reply_to three-layer resolution (integration)', () => {
  it('event payload _reply_to wins over tenant replyTo (highest-priority end-to-end)', async () => {
    const event = {
      tenant_id: tenant.id,
      event_type: 'test.replyto',
      event_id: `evt-replyto-${Date.now()}`,
      payload: { name: 'Alice', _reply_to: 'event@x.com' },
      timestamp: new Date().toISOString(),
    };

    // Re-fetch tenant config (factory may have stale view)
    const [tenantRow] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenant.id))
      .limit(1);

    await processNotification(db, event, rule, 'customer@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: tenantRow.config,
    });

    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const sendArgs = mockResendSend.mock.calls[0][0];
    expect(sendArgs.replyTo).toBe('event@x.com');

    // Verify notification status
    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));
    expect(notif.status).toBe('sent');
  });
});
