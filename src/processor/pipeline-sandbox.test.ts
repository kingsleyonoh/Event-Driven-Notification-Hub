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
  // Tenant starts in sandbox mode (sandbox: true)
  tenant = await createTestTenant(db, {
    config: {
      channels: {
        email: {
          apiKey: 're_test_sandbox',
          from: 'noreply@sandbox.test',
          sandbox: true,
        },
      },
    },
  });
  template = await createTestTemplate(db, tenant.id, {
    subject: 'Sandbox subject {{n}}',
    body: 'Sandbox body content {{n}} — long enough to exercise the body excerpt logging path.',
  });
  rule = await createTestRule(db, tenant.id, template.id, {
    eventType: 'sandbox.test',
    channel: 'email',
    recipientType: 'static',
    recipientValue: 'sandbox-recipient@example.com',
  });
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

beforeEach(() => {
  mockResendSend.mockReset();
  // Default: send succeeds (only used in the real-mode test)
  mockResendSend.mockResolvedValue({ data: { id: 'msg-real' }, error: null });
});

function makeEvent(overrides: Partial<{ event_id: string; payload: Record<string, unknown> }> = {}) {
  return {
    tenant_id: tenant.id,
    event_type: 'sandbox.test',
    event_id: overrides.event_id ?? `sb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload: overrides.payload ?? { n: '1' },
    timestamp: new Date().toISOString(),
  };
}

async function loadTenantConfig(): Promise<Record<string, unknown> | null> {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, tenant.id));
  return row?.config ?? null;
}

describe('processNotification — sandbox mode (integration)', () => {
  it('does not call Resend when sandbox=true and marks notification status sent_sandbox', async () => {
    const tenantConfig = await loadTenantConfig();
    const event = makeEvent({ event_id: `sb-skip-${Date.now()}` });

    await processNotification(db, event, rule, 'sandbox-recipient@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig,
    });

    // Resend was NEVER called — sandbox skips the send entirely
    expect(mockResendSend).not.toHaveBeenCalled();

    // Notification row exists and has status = 'sent_sandbox'
    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));
    expect(notif).toBeDefined();
    expect(notif.status).toBe('sent_sandbox');
  });

  it('completes the sandbox pipeline successfully end-to-end (not skipped, not failed)', async () => {
    const tenantConfig = await loadTenantConfig();
    const event = makeEvent({ event_id: `sb-flow-${Date.now()}` });

    await processNotification(db, event, rule, 'sandbox-recipient@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig,
    });

    expect(mockResendSend).not.toHaveBeenCalled();

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));
    expect(notif).toBeDefined();
    // Positive assertion: sandbox flow lands on sent_sandbox — NOT skipped, NOT failed, NOT pending
    expect(notif.status).toBe('sent_sandbox');
    expect(notif.skipReason).toBeNull();
    expect(notif.errorMessage).toBeNull();
    // Subject + body excerpt were rendered through the template engine
    expect(notif.subject).toBe('Sandbox subject 1');
    expect(notif.bodyPreview).toContain('Sandbox body content 1');
  });

  it('calls Resend and marks status sent (not sent_sandbox) when tenant flips sandbox=false', async () => {
    // Flip the tenant out of sandbox mode
    await db
      .update(tenants)
      .set({
        config: {
          channels: {
            email: {
              apiKey: 're_test_sandbox',
              from: 'noreply@sandbox.test',
              sandbox: false,
            },
          },
        },
      })
      .where(eq(tenants.id, tenant.id));

    const tenantConfig = await loadTenantConfig();
    const event = makeEvent({ event_id: `sb-real-${Date.now()}` });

    await processNotification(db, event, rule, 'sandbox-recipient@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig,
    });

    // Resend WAS called — sandbox is off
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const sendArgs = mockResendSend.mock.calls[0][0];
    expect(sendArgs.to).toBe('sandbox-recipient@example.com');
    expect(sendArgs.subject).toBe('Sandbox subject 1');

    // Notification row has status = 'sent' (NOT 'sent_sandbox')
    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));
    expect(notif).toBeDefined();
    expect(notif.status).toBe('sent');
  });
});

// Phase 7.5 — regression test for the sandbox+missing-apiKey gotcha
// (gotcha 2026-04-26-sandbox-requires-fake-api-key.md). A sandbox-only
// tenant with NO apiKey set in config previously failed Zod validation,
// the resolver returned null, and the dispatcher fell back to the env-var
// Resend client — silently bypassing sandbox and attempting a real send.
// Fix: emailChannelConfigSchema.superRefine makes apiKey optional when
// sandbox=true. This test enforces the contract end-to-end at the pipeline
// level: a sandbox-only tenant (no apiKey) MUST land on sent_sandbox.
describe('processNotification — sandbox-only tenant without apiKey (Phase 7.5 regression)', () => {
  let sbTenant: Awaited<ReturnType<typeof createTestTenant>>;
  let sbTemplate: Awaited<ReturnType<typeof createTestTemplate>>;
  let sbRule: Awaited<ReturnType<typeof createTestRule>>;

  beforeAll(async () => {
    sbTenant = await createTestTenant(db, {
      config: {
        channels: {
          email: {
            // NO apiKey — sandbox-only tenant should still reach the
            // H5 short-circuit because superRefine treats apiKey as
            // optional when sandbox === true.
            from: 'noreply@sandbox-only.test',
            sandbox: true,
          },
        },
      },
    });
    sbTemplate = await createTestTemplate(db, sbTenant.id, {
      subject: 'No-key sandbox subject',
      body: 'No-key sandbox body',
    });
    sbRule = await createTestRule(db, sbTenant.id, sbTemplate.id, {
      eventType: 'sandbox.nokey',
      channel: 'email',
      recipientType: 'static',
      recipientValue: 'nokey@example.com',
    });
  });

  afterAll(async () => {
    await cleanupTestData(db, sbTenant.id);
  });

  it('sandbox-only tenant (no apiKey) reaches sent_sandbox without invoking Resend', async () => {
    const [row] = await db.select().from(tenants).where(eq(tenants.id, sbTenant.id));
    const tenantConfig = row?.config ?? null;

    const event = {
      tenant_id: sbTenant.id,
      event_type: 'sandbox.nokey',
      event_id: `sb-nokey-${Date.now()}`,
      payload: { n: '99' },
      timestamp: new Date().toISOString(),
    };

    await processNotification(db, event, sbRule, 'nokey@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig,
    });

    // Resend NEVER called — H5 short-circuit fires before any Resend
    // client is constructed (which would have thrown on missing apiKey).
    expect(mockResendSend).not.toHaveBeenCalled();

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));
    expect(notif).toBeDefined();
    expect(notif.status).toBe('sent_sandbox');
    expect(notif.errorMessage).toBeNull();
  });
});
