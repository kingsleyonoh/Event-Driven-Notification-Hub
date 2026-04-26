import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import { tenants, notifications, emailDeliveryEvents } from '../db/schema.js';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { rateLimiterPlugin } from './middleware/rate-limiter.js';
import { webhookRoutes } from './webhooks.routes.js';
import { createTestTenant, createTestNotification, cleanupTestData } from '../test/factories.js';

const WEBHOOK_SECRET = 'whsec_' + Buffer.from('test-secret-bytes-must-be-long-enough').toString('base64');

const createdTenantIds: string[] = [];

afterAll(async () => {
  for (const id of createdTenantIds) {
    await db.delete(emailDeliveryEvents).where(eq(emailDeliveryEvents.tenantId, id));
    await cleanupTestData(db, id);
  }
  await sql.end();
});

async function buildTestApp(secret = WEBHOOK_SECRET) {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(rateLimiterPlugin);
  await app.register(webhookRoutes, { db, webhookSecret: secret });
  return app;
}

function signSvix(rawBody: string, svixId: string, timestamp: string, secret: string): string {
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const signedContent = `${svixId}.${timestamp}.${rawBody}`;
  const sig = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');
  return `v1,${sig}`;
}

describe('POST /api/webhooks/resend — signature gating', () => {
  it('rejects with 401 when signature is invalid', async () => {
    const app = await buildTestApp();
    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'e_x' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/resend',
      headers: {
        'content-type': 'application/json',
        'svix-id': 'msg_a',
        'svix-timestamp': String(Math.floor(Date.now() / 1000)),
        'svix-signature': 'v1,wrong-sig',
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a properly-signed webhook and INSERTs an email_delivery_events row', async () => {
    const tenant = await createTestTenant(db, { id: `t-webhook-${crypto.randomBytes(3).toString('hex')}` });
    createdTenantIds.push(tenant.id);

    // Create a notification we will correlate to via X-Hub-Notification-ID.
    const notif = await createTestNotification(db, {
      tenantId: tenant.id,
      eventType: 'evt.test',
      eventId: 'evt-1',
      recipient: 'user@example.com',
      channel: 'email',
      status: 'sent',
    });

    const payload = {
      type: 'email.delivered',
      created_at: new Date().toISOString(),
      data: {
        email_id: 'resend_msg_123',
        headers: {
          'X-Hub-Notification-ID': notif.id,
          'X-Hub-Tenant-ID': tenant.id,
        },
      },
    };
    const rawBody = JSON.stringify(payload);
    const svixId = 'msg_real';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signSvix(rawBody, svixId, timestamp, WEBHOOK_SECRET);

    const app = await buildTestApp();
    const res = await app.inject({
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

    const events = await db
      .select()
      .from(emailDeliveryEvents)
      .where(eq(emailDeliveryEvents.tenantId, tenant.id));
    expect(events.length).toBe(1);
    expect(events[0].resendEmailId).toBe('resend_msg_123');
    expect(events[0].notificationId).toBe(notif.id);
    expect(events[0].eventType).toBe('email.delivered');

    // Notification's deliveredAt should now be set.
    const [updated] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notif.id));
    expect(updated.deliveredAt).toBeTruthy();
  });

  it('marks notification failed with bounce_type on email.bounced', async () => {
    const tenant = await createTestTenant(db, { id: `t-bounce-${crypto.randomBytes(3).toString('hex')}` });
    createdTenantIds.push(tenant.id);

    const notif = await createTestNotification(db, {
      tenantId: tenant.id,
      eventType: 'evt.bounce',
      eventId: 'evt-bounce-1',
      recipient: 'bouncer@example.com',
      channel: 'email',
      status: 'sent',
    });

    const payload = {
      type: 'email.bounced',
      created_at: new Date().toISOString(),
      data: {
        email_id: 'resend_msg_bounce',
        bounce: { type: 'hard_bounce' },
        headers: {
          'X-Hub-Notification-ID': notif.id,
          'X-Hub-Tenant-ID': tenant.id,
        },
      },
    };
    const rawBody = JSON.stringify(payload);
    const svixId = 'msg_bounce';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signSvix(rawBody, svixId, timestamp, WEBHOOK_SECRET);

    const app = await buildTestApp();
    const res = await app.inject({
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

    const [updated] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notif.id));
    expect(updated.status).toBe('failed');
    expect(updated.bounceType).toBe('hard_bounce');
    expect(updated.errorMessage).toContain('bounce');
  });
});

// Phase 7.6 regression — the webhook plugin's `addContentTypeParser` for
// application/json MUST stay encapsulated and NOT leak to sibling routes.
// Production smoke test 2026-04-26 caught this: when webhookRoutes was
// wrapped in `fp()` (which BREAKS encapsulation), every other JSON-POST
// endpoint in the app failed with "Request body size did not match
// Content-Length" because the raw-body parser overrode the default JSON
// parser globally. This test registers webhookRoutes alongside a simple
// JSON-POST route and confirms BOTH work — the original test suite
// missed this because it only registered webhookRoutes in isolation.
describe('Phase 7.6 — webhook plugin must not leak content-type parser', () => {
  it('does not break sibling JSON-POST routes when registered together', async () => {
    const app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.register(rateLimiterPlugin);

    // Register a simple sibling JSON-POST route BEFORE the webhook plugin
    app.post('/api/test-sibling', async (request) => {
      const body = request.body as { value?: string };
      return { received: body?.value ?? null };
    });

    // Register the webhook plugin — its content-type parser MUST stay
    // scoped to its own plugin context.
    await app.register(webhookRoutes, { db, webhookSecret: WEBHOOK_SECRET });

    // The sibling route must still parse JSON normally — Fastify's default
    // parser, NOT the raw-string parser the webhook plugin registers.
    const res = await app.inject({
      method: 'POST',
      url: '/api/test-sibling',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ value: 'hello' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: 'hello' });
  });
});
