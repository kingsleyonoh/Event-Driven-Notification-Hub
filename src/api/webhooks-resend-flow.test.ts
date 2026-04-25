import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import { tenants, notifications, emailDeliveryEvents } from '../db/schema.js';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { rateLimiterPlugin } from './middleware/rate-limiter.js';
import { webhookRoutes } from './webhooks.routes.js';
import { createTestTenant, createTestNotification, cleanupTestData } from '../test/factories.js';

/**
 * Phase 7 H4 — End-to-end integration tests for the Resend webhook flow.
 *
 * Verifies the full chain:
 *   POST /api/webhooks/resend (signed)
 *     → INSERT email_delivery_events row
 *     → UPDATE notifications row (status / bounce_type / delivered_at)
 *     → fire-and-forget POST to tenant's deliveryCallbackUrl with HMAC signature
 *     → UPDATE email_delivery_events.callback_status_code
 *
 * The Resend webhook itself is simulated by computing the Svix signature
 * directly (the verification helper IS the production code path). The
 * tenant-side fetch is mocked because it's external to the Hub.
 */

const WEBHOOK_SECRET = 'whsec_' + Buffer.from('test-secret-bytes-must-be-long-enough').toString('base64');
// 64-hex char delivery callback secret (matches `generateDeliveryCallbackSecret`).
const TENANT_CALLBACK_SECRET = 'a'.repeat(64);
const CALLBACK_URL = 'http://test-callback.local/hook';

const createdTenantIds: string[] = [];

afterAll(async () => {
  for (const id of createdTenantIds) {
    await db.delete(emailDeliveryEvents).where(eq(emailDeliveryEvents.tenantId, id));
    await cleanupTestData(db, id);
  }
  await sql.end();
});

let app: FastifyInstance | null = null;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);

  app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(rateLimiterPlugin);
  await app.register(webhookRoutes, { db, webhookSecret: WEBHOOK_SECRET });
});

afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Sign a body with the test webhook secret using the Svix scheme. */
function signSvix(rawBody: string, svixId: string, timestamp: string, secret: string): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${svixId}.${timestamp}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

/**
 * Poll `predicate` until it returns true or `timeoutMs` elapses.
 * Used to wait for the fire-and-forget callback dispatch to complete
 * without resorting to a fixed `setTimeout` (which would be racy).
 */
async function waitFor(
  predicate: () => boolean,
  { timeoutMs = 2000, intervalMs = 20 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`waitFor: predicate did not become true within ${timeoutMs}ms`);
}

/**
 * Re-compute the canonical-JSON body the Hub would have sent and verify
 * the X-Hub-Signature header matches. Mirrors what a tenant would do
 * server-side to verify a Hub callback.
 */
function verifyHubSignature(rawBody: string, signatureHeader: string, secret: string): boolean {
  const expected =
    'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signatureHeader),
    Buffer.from(expected),
  );
}

async function createTenantWithCallback(idPrefix: string) {
  const tenant = await createTestTenant(db, {
    id: `${idPrefix}-${crypto.randomBytes(3).toString('hex')}`,
    config: {
      channels: {
        email: {
          apiKey: 're_test_key',
          from: 'sender@example.com',
          deliveryCallbackUrl: CALLBACK_URL,
        },
      },
    },
    deliveryCallbackSecret: TENANT_CALLBACK_SECRET,
  });
  createdTenantIds.push(tenant.id);
  return tenant;
}

describe('POST /api/webhooks/resend — full delivery callback flow', () => {
  it('bounce webhook → notification row updated → mock callback URL receives signed POST', async () => {
    const tenant = await createTenantWithCallback('t-flow-bounce');

    const notif = await createTestNotification(db, {
      tenantId: tenant.id,
      eventType: 'evt.flow',
      eventId: `evt-flow-${crypto.randomBytes(2).toString('hex')}`,
      recipient: 'bouncer@example.com',
      channel: 'email',
      status: 'sent',
    });

    // Mock the tenant's callback endpoint as a 200 OK.
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }));

    const payload = {
      type: 'email.bounced',
      created_at: new Date().toISOString(),
      data: {
        email_id: 'resend_msg_flow_bounce',
        bounce: { type: 'hard_bounce' },
        headers: {
          'X-Hub-Notification-ID': notif.id,
          'X-Hub-Tenant-ID': tenant.id,
        },
      },
    };
    const rawBody = JSON.stringify(payload);
    const svixId = 'msg_flow_bounce';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signSvix(rawBody, svixId, timestamp, WEBHOOK_SECRET);

    const res = await app!.inject({
      method: 'POST',
      url: '/api/webhooks/resend',
      headers: {
        'content-type': 'application/json',
        'svix-id': svixId,
        'svix-timestamp': timestamp,
        'svix-signature': signature,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });

    // email_delivery_events row inserted with correct fields.
    const events = await db
      .select()
      .from(emailDeliveryEvents)
      .where(eq(emailDeliveryEvents.tenantId, tenant.id));
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('email.bounced');
    expect(events[0].notificationId).toBe(notif.id);
    expect(events[0].rawPayload).toMatchObject({ type: 'email.bounced' });

    // notifications row updated to failed + bounce metadata.
    const [updated] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notif.id));
    expect(updated.status).toBe('failed');
    expect(updated.bounceType).toBe('hard_bounce');
    expect(updated.errorMessage).toContain('bounce');

    // Wait for the fire-and-forget callback dispatch to complete.
    await waitFor(() => mockFetch.mock.calls.length >= 1);

    // The mock fetch was called with the tenant's callback URL.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(CALLBACK_URL);
    expect(calledInit.method).toBe('POST');

    // The X-Hub-Signature header matches HMAC-SHA256(rawBody, tenantSecret).
    const calledHeaders = calledInit.headers as Record<string, string>;
    expect(calledHeaders['Content-Type']).toBe('application/json');
    const sig = calledHeaders['X-Hub-Signature'];
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyHubSignature(calledInit.body as string, sig, TENANT_CALLBACK_SECRET)).toBe(true);

    // callback_status_code persisted.
    await waitFor(async () => {
      const [evt] = await db
        .select()
        .from(emailDeliveryEvents)
        .where(eq(emailDeliveryEvents.tenantId, tenant.id));
      return evt?.callbackStatusCode === 200;
    });
    const [evtFinal] = await db
      .select()
      .from(emailDeliveryEvents)
      .where(eq(emailDeliveryEvents.tenantId, tenant.id));
    expect(evtFinal.callbackStatusCode).toBe(200);
  });

  it('callback URL returns 500 → callback_status_code logged but webhook still 200s', async () => {
    const tenant = await createTenantWithCallback('t-flow-500');

    const notif = await createTestNotification(db, {
      tenantId: tenant.id,
      eventType: 'evt.flow',
      eventId: `evt-flow-500-${crypto.randomBytes(2).toString('hex')}`,
      recipient: 'recipient@example.com',
      channel: 'email',
      status: 'sent',
    });

    // Mock tenant callback as 500 — Hub must not propagate this back to Resend.
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }));

    const payload = {
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: {
        email_id: 'resend_msg_flow_500',
        headers: {
          'X-Hub-Notification-ID': notif.id,
          'X-Hub-Tenant-ID': tenant.id,
        },
      },
    };
    const rawBody = JSON.stringify(payload);
    const svixId = 'msg_flow_500';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signSvix(rawBody, svixId, timestamp, WEBHOOK_SECRET);

    const res = await app!.inject({
      method: 'POST',
      url: '/api/webhooks/resend',
      headers: {
        'content-type': 'application/json',
        'svix-id': svixId,
        'svix-timestamp': timestamp,
        'svix-signature': signature,
      },
      payload: rawBody,
    });

    // Webhook still returns 200 — tenant failures don't propagate to Resend.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });

    // The notification row was still updated (deliveredAt set on email.delivered).
    const [updated] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notif.id));
    expect(updated.deliveredAt).toBeTruthy();

    // Wait for the fire-and-forget callback to land + log status.
    await waitFor(() => mockFetch.mock.calls.length >= 1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // callback_status_code = 500 persisted.
    await waitFor(async () => {
      const [evt] = await db
        .select()
        .from(emailDeliveryEvents)
        .where(eq(emailDeliveryEvents.tenantId, tenant.id));
      return evt?.callbackStatusCode === 500;
    });
    const [evtFinal] = await db
      .select()
      .from(emailDeliveryEvents)
      .where(eq(emailDeliveryEvents.tenantId, tenant.id));
    expect(evtFinal.callbackStatusCode).toBe(500);
  });

  it('tenant B has no email_delivery_events row when tenant A receives the webhook', async () => {
    // Multi-tenant fixture: A receives a webhook; B is untouched.
    const tenantA = await createTenantWithCallback('t-flow-A');
    const tenantB = await createTenantWithCallback('t-flow-B');

    const notif = await createTestNotification(db, {
      tenantId: tenantA.id,
      eventType: 'evt.iso',
      eventId: `evt-iso-${crypto.randomBytes(2).toString('hex')}`,
      recipient: 'a@example.com',
      channel: 'email',
      status: 'sent',
    });

    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

    const payload = {
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: {
        email_id: 'resend_msg_iso',
        headers: {
          'X-Hub-Notification-ID': notif.id,
          'X-Hub-Tenant-ID': tenantA.id,
        },
      },
    };
    const rawBody = JSON.stringify(payload);
    const svixId = 'msg_iso';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signSvix(rawBody, svixId, timestamp, WEBHOOK_SECRET);

    const res = await app!.inject({
      method: 'POST',
      url: '/api/webhooks/resend',
      headers: {
        'content-type': 'application/json',
        'svix-id': svixId,
        'svix-timestamp': timestamp,
        'svix-signature': signature,
      },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);

    const eventsA = await db
      .select()
      .from(emailDeliveryEvents)
      .where(eq(emailDeliveryEvents.tenantId, tenantA.id));
    const eventsB = await db
      .select()
      .from(emailDeliveryEvents)
      .where(eq(emailDeliveryEvents.tenantId, tenantB.id));
    expect(eventsA.length).toBe(1);
    expect(eventsB.length).toBe(0);
  });
});
