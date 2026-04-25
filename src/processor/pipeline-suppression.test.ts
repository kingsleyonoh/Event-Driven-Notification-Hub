import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import {
  createTestTenant, createTestTemplate, createTestRule, cleanupTestData,
} from '../test/factories.js';
import { notifications, tenantSuppressions } from '../db/schema.js';
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
        email: { apiKey: 're_test_suppression', from: 'noreply@test.com' },
      },
    },
  });
  template = await createTestTemplate(db, tenant.id, {
    subject: 'Suppression subject',
    body: 'Suppression body content',
  });
  rule = await createTestRule(db, tenant.id, template.id, {
    eventType: 'suppression.test',
    channel: 'email',
    recipientType: 'static',
    recipientValue: 'bouncer@x.com',
  });
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

beforeEach(async () => {
  mockResendSend.mockReset();
  mockResendSend.mockResolvedValue({ data: { id: 'msg-suppression' }, error: null });
  // Clear suppressions between tests
  await db.delete(tenantSuppressions).where(eq(tenantSuppressions.tenantId, tenant.id));
});

function makeEvent(overrides: Partial<{ event_id: string; payload: Record<string, unknown> }> = {}) {
  return {
    tenant_id: tenant.id,
    event_type: 'suppression.test',
    event_id: overrides.event_id ?? `sup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload: overrides.payload ?? {},
    timestamp: new Date().toISOString(),
  };
}

describe('processNotification — pre-dispatch suppression check', () => {
  it('skips notification with skip_reason=suppressed when recipient is on tenant suppression list', async () => {
    // Insert a suppression for bouncer@x.com (note: stored lowercased by handler)
    await db.insert(tenantSuppressions).values({
      tenantId: tenant.id,
      recipient: 'bouncer@x.com',
      reason: 'hard_bounce',
    });

    const event = makeEvent({ event_id: `sup-skip-${Date.now()}` });

    await processNotification(db, event, rule, 'bouncer@x.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: tenant.config,
    });

    // Resend was NEVER called — suppression blocked dispatch
    expect(mockResendSend).not.toHaveBeenCalled();

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));
    expect(notif).toBeDefined();
    expect(notif.status).toBe('skipped');
    expect(notif.skipReason).toBe('suppressed');
  });

  it('proceeds with dispatch when suppression is for a different recipient (case-insensitive scoped)', async () => {
    // Suppress OTHER@x.com — current send target is bouncer@x.com
    await db.insert(tenantSuppressions).values({
      tenantId: tenant.id,
      recipient: 'other@x.com',
      reason: 'manual',
    });

    const event = makeEvent({ event_id: `sup-pass-${Date.now()}` });

    await processNotification(db, event, rule, 'bouncer@x.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: tenant.config,
    });

    // Different recipient → suppression does not apply → Resend called
    expect(mockResendSend).toHaveBeenCalledTimes(1);

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));
    expect(notif).toBeDefined();
    expect(notif.status).toBe('sent');
    expect(notif.skipReason).toBeNull();
  });
});
