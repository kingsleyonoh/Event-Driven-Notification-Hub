// Phase 7 7b — Tenant pass-through metadata.
// Pipeline copies `event.payload._metadata` into `notifications.metadata` so
// tenants can correlate Hub-emitted notifications back to their own
// request_id / trace_id surfaces. The reserved `_metadata` underscore-prefix
// matches the `_reply_to` convention (Phase 7 H2).

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import {
  createTestTenant, createTestTemplate, createTestRule, cleanupTestData,
} from '../test/factories.js';
import { tenants, notifications } from '../db/schema.js';
import { processNotification } from './pipeline.js';

const mockResendSend = vi.fn();

vi.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: mockResendSend };
  },
}));

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let template: Awaited<ReturnType<typeof createTestTemplate>>;
let rule: Awaited<ReturnType<typeof createTestRule>>;

beforeAll(async () => {
  tenant = await createTestTenant(db, {
    config: {
      channels: {
        email: { apiKey: 're_test', from: 'noreply@test.com' },
      },
    },
  });
  template = await createTestTemplate(db, tenant.id, {
    subject: 'Hello',
    body: 'Body',
  });
  rule = await createTestRule(db, tenant.id, template.id, {
    eventType: 'test.metadata',
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
  mockResendSend.mockResolvedValue({ data: { id: 'msg-meta' }, error: null });
});

describe('processNotification — tenant metadata pass-through (Phase 7 7b)', () => {
  it('copies event.payload._metadata into notifications.metadata', async () => {
    const event = {
      tenant_id: tenant.id,
      event_type: 'test.metadata',
      event_id: `evt-meta-${Date.now()}`,
      payload: {
        name: 'Alice',
        _metadata: {
          request_id: 'req-abc-123',
          trace_id: 'trace-xyz',
          custom: { nested: 'value' },
        },
      },
      timestamp: new Date().toISOString(),
    };

    const [tenantRow] = await db
      .select().from(tenants).where(eq(tenants.id, tenant.id)).limit(1);

    await processNotification(db, event, rule, 'customer@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: tenantRow.config,
    });

    const [notif] = await db
      .select().from(notifications).where(eq(notifications.eventId, event.event_id));

    expect(notif).toBeDefined();
    expect(notif.metadata).toEqual({
      request_id: 'req-abc-123',
      trace_id: 'trace-xyz',
      custom: { nested: 'value' },
    });
  });

  it('leaves notifications.metadata null when event has no _metadata', async () => {
    const event = {
      tenant_id: tenant.id,
      event_type: 'test.metadata',
      event_id: `evt-nometa-${Date.now()}`,
      payload: { name: 'Bob' },
      timestamp: new Date().toISOString(),
    };

    const [tenantRow] = await db
      .select().from(tenants).where(eq(tenants.id, tenant.id)).limit(1);

    await processNotification(db, event, rule, 'customer@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: tenantRow.config,
    });

    const [notif] = await db
      .select().from(notifications).where(eq(notifications.eventId, event.event_id));

    expect(notif).toBeDefined();
    expect(notif.metadata).toBeNull();
  });

  it('does not copy non-object _metadata (defensive)', async () => {
    const event = {
      tenant_id: tenant.id,
      event_type: 'test.metadata',
      event_id: `evt-badmeta-${Date.now()}`,
      payload: { name: 'Carol', _metadata: 'not-an-object' },
      timestamp: new Date().toISOString(),
    };

    const [tenantRow] = await db
      .select().from(tenants).where(eq(tenants.id, tenant.id)).limit(1);

    await processNotification(db, event, rule, 'customer@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: tenantRow.config,
    });

    const [notif] = await db
      .select().from(notifications).where(eq(notifications.eventId, event.event_id));

    expect(notif).toBeDefined();
    expect(notif.metadata).toBeNull();
  });
});
