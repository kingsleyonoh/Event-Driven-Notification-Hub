import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import {
  createTestTenant, createTestTemplate, createTestRule, cleanupTestData,
} from '../test/factories.js';
import { notifications, tenantSuppressions } from '../db/schema.js';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { authPlugin } from './middleware/auth.js';
import { suppressionsRoutes } from './suppressions.routes.js';
import { processNotification } from '../processor/pipeline.js';

// Mock Resend so the post-unblock dispatch path has a working channel
const mockResendSend = vi.fn();

vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = { send: mockResendSend };
    },
  };
});

let tenantA: Awaited<ReturnType<typeof createTestTenant>>;
let tenantB: Awaited<ReturnType<typeof createTestTenant>>;
let templateA: Awaited<ReturnType<typeof createTestTemplate>>;
let ruleA: Awaited<ReturnType<typeof createTestRule>>;

beforeAll(async () => {
  tenantA = await createTestTenant(db, {
    config: {
      channels: {
        email: { apiKey: 're_test_supp_a', from: 'noreply@a.test' },
      },
    },
  });
  tenantB = await createTestTenant(db, {
    config: {
      channels: {
        email: { apiKey: 're_test_supp_b', from: 'noreply@b.test' },
      },
    },
  });
  templateA = await createTestTemplate(db, tenantA.id, {
    subject: 'Subject',
    body: 'Body',
  });
  ruleA = await createTestRule(db, tenantA.id, templateA.id, {
    eventType: 'supp.api.test',
    channel: 'email',
    recipientType: 'static',
    recipientValue: 'block-target@x.com',
  });
});

afterAll(async () => {
  await cleanupTestData(db, tenantA.id);
  await cleanupTestData(db, tenantB.id);
  await sql.end();
});

beforeEach(async () => {
  mockResendSend.mockReset();
  mockResendSend.mockResolvedValue({ data: { id: 'msg-supp-api' }, error: null });
  await db.delete(tenantSuppressions).where(eq(tenantSuppressions.tenantId, tenantA.id));
  await db.delete(tenantSuppressions).where(eq(tenantSuppressions.tenantId, tenantB.id));
  await db.delete(notifications).where(eq(notifications.tenantId, tenantA.id));
});

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, { db });
  await app.register(suppressionsRoutes, { db });
  return app;
}

function headers(apiKey?: string) {
  return { 'x-api-key': apiKey ?? tenantA.apiKey };
}

function makeEvent(eventId: string) {
  return {
    tenant_id: tenantA.id,
    event_type: 'supp.api.test',
    event_id: eventId,
    payload: {} as Record<string, unknown>,
    timestamp: new Date().toISOString(),
  };
}

describe('Suppressions API — POST /api/suppressions', () => {
  it('creates a suppression with default reason=manual and blocks subsequent dispatch', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/suppressions',
      headers: headers(),
      payload: { recipient: 'block-target@x.com' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.suppression).toBeDefined();
    expect(body.suppression.recipient).toBe('block-target@x.com');
    expect(body.suppression.reason).toBe('manual');
    expect(body.suppression.tenantId).toBe(tenantA.id);
    expect(body.suppression.id).toBeDefined();

    // Run pipeline against suppressed recipient → must be skipped
    await processNotification(db, makeEvent(`evt-block-${Date.now()}`), ruleA, 'block-target@x.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: tenantA.config,
    });

    expect(mockResendSend).not.toHaveBeenCalled();

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, tenantA.id));
    expect(notif).toBeDefined();
    expect(notif.status).toBe('skipped');
    expect(notif.skipReason).toBe('suppressed');
  });

  it('returns 200 with existing row on duplicate insert (idempotent)', async () => {
    const app = await buildTestApp();
    const first = await app.inject({
      method: 'POST',
      url: '/api/suppressions',
      headers: headers(),
      payload: { recipient: 'dup@x.com', reason: 'unsubscribed' },
    });
    expect(first.statusCode).toBe(201);
    const firstId = first.json().suppression.id;

    const second = await app.inject({
      method: 'POST',
      url: '/api/suppressions',
      headers: headers(),
      payload: { recipient: 'dup@x.com', reason: 'manual' },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().suppression.id).toBe(firstId);
    // Existing row preserved (reason stays unsubscribed)
    expect(second.json().suppression.reason).toBe('unsubscribed');
  });

  it('rejects invalid email recipient with 400', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/suppressions',
      headers: headers(),
      payload: { recipient: 'not-an-email' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('accepts expires_at as ISO datetime', async () => {
    const app = await buildTestApp();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const res = await app.inject({
      method: 'POST',
      url: '/api/suppressions',
      headers: headers(),
      payload: { recipient: 'expires@x.com', reason: 'manual', expires_at: future },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().suppression.expiresAt).toBeTruthy();
  });
});

describe('Suppressions API — DELETE /api/suppressions/:id', () => {
  it('deletes a suppression and unblocks the recipient', async () => {
    const app = await buildTestApp();

    // Block first
    const created = await app.inject({
      method: 'POST',
      url: '/api/suppressions',
      headers: headers(),
      payload: { recipient: 'block-target@x.com', reason: 'manual' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().suppression.id;

    // Verify blocked
    await processNotification(db, makeEvent(`evt-blocked-${Date.now()}`), ruleA, 'block-target@x.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: tenantA.config,
    });
    expect(mockResendSend).not.toHaveBeenCalled();

    // Delete suppression
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/suppressions/${id}`,
      headers: headers(),
    });
    expect(del.statusCode).toBe(204);

    // Verify removed
    const remaining = await db
      .select()
      .from(tenantSuppressions)
      .where(eq(tenantSuppressions.id, id));
    expect(remaining.length).toBe(0);

    // Now dispatch should proceed (different eventId — avoid dedup)
    mockResendSend.mockReset();
    mockResendSend.mockResolvedValue({ data: { id: 'msg-after-unblock' }, error: null });

    await processNotification(db, makeEvent(`evt-unblocked-${Date.now()}`), ruleA, 'block-target@x.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: tenantA.config,
    });

    expect(mockResendSend).toHaveBeenCalledTimes(1);

    const sentRows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.tenantId, tenantA.id));
    const sentRow = sentRows.find((n) => n.status === 'sent');
    expect(sentRow).toBeDefined();
  });

  it('returns 404 when deleting an unknown id', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/suppressions/00000000-0000-0000-0000-000000000000',
      headers: headers(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when deleting another tenant\'s suppression (cross-tenant isolation)', async () => {
    // Create a suppression on tenantB directly via DB
    const [other] = await db
      .insert(tenantSuppressions)
      .values({
        tenantId: tenantB.id,
        recipient: 'b-only@x.com',
        reason: 'manual',
      })
      .returning();

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/suppressions/${other.id}`,
      headers: headers(tenantA.apiKey),
    });
    expect(res.statusCode).toBe(404);

    // Tenant B's row still present
    const stillThere = await db
      .select()
      .from(tenantSuppressions)
      .where(eq(tenantSuppressions.id, other.id));
    expect(stillThere.length).toBe(1);
  });
});

describe('Suppressions API — GET /api/suppressions', () => {
  it('lists tenant\'s suppressions only (cross-tenant isolation)', async () => {
    // Seed for tenantA
    await db.insert(tenantSuppressions).values([
      { tenantId: tenantA.id, recipient: 'a1@x.com', reason: 'manual' },
      { tenantId: tenantA.id, recipient: 'a2@x.com', reason: 'hard_bounce' },
    ]);
    // Seed for tenantB
    await db.insert(tenantSuppressions).values([
      { tenantId: tenantB.id, recipient: 'b-secret@x.com', reason: 'complaint' },
    ]);

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/suppressions',
      headers: headers(tenantA.apiKey),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(2);
    const recipients = body.data.map((r: { recipient: string }) => r.recipient).sort();
    expect(recipients).toEqual(['a1@x.com', 'a2@x.com']);
    // Tenant B's row must not leak
    expect(body.data.every((r: { tenantId: string }) => r.tenantId === tenantA.id)).toBe(true);
    expect(body.nextCursor).toBeNull();
  });

  it('paginates with cursor when more than limit rows exist', async () => {
    // Seed 5 suppressions for tenantA
    await db.insert(tenantSuppressions).values([
      { tenantId: tenantA.id, recipient: 'p1@x.com', reason: 'manual' },
      { tenantId: tenantA.id, recipient: 'p2@x.com', reason: 'manual' },
      { tenantId: tenantA.id, recipient: 'p3@x.com', reason: 'manual' },
      { tenantId: tenantA.id, recipient: 'p4@x.com', reason: 'manual' },
      { tenantId: tenantA.id, recipient: 'p5@x.com', reason: 'manual' },
    ]);

    const app = await buildTestApp();
    const page1 = await app.inject({
      method: 'GET',
      url: '/api/suppressions?limit=2',
      headers: headers(),
    });
    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.data.length).toBe(2);
    expect(body1.nextCursor).toBeTruthy();

    const page2 = await app.inject({
      method: 'GET',
      url: `/api/suppressions?limit=2&cursor=${encodeURIComponent(body1.nextCursor)}`,
      headers: headers(),
    });
    expect(page2.statusCode).toBe(200);
    const body2 = page2.json();
    expect(body2.data.length).toBe(2);

    const ids1 = body1.data.map((r: { id: string }) => r.id);
    const ids2 = body2.data.map((r: { id: string }) => r.id);
    expect(ids1.filter((id: string) => ids2.includes(id)).length).toBe(0);
  });
});
