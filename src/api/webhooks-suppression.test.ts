import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import { notifications, tenantSuppressions } from '../db/schema.js';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { rateLimiterPlugin } from './middleware/rate-limiter.js';
import { webhookRoutes } from './webhooks.routes.js';
import {
  createTestTenant, createTestTemplate, createTestRule,
  createTestNotification, cleanupTestData,
} from '../test/factories.js';
import { processNotification } from '../processor/pipeline.js';

const WEBHOOK_SECRET = 'whsec_' + Buffer.from('test-secret-bytes-must-be-long-enough').toString('base64');

// Mock Resend so the post-suppression event-processing step has a working channel
const mockResendSend = vi.fn();

vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = { send: mockResendSend };
    },
  };
});

const createdTenantIds: string[] = [];

afterAll(async () => {
  for (const id of createdTenantIds) {
    await cleanupTestData(db, id);
  }
  await sql.end();
});

beforeEach(() => {
  mockResendSend.mockReset();
  mockResendSend.mockResolvedValue({ data: { id: 'msg-after-suppression' }, error: null });
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

describe('Resend hard-bounce webhook → tenant_suppressions auto-add → next event skipped', () => {
  it('inserts a tenant_suppressions row on hard bounce, then skips a subsequent send to that recipient', async () => {
    const tenant = await createTestTenant(db, {
      id: `t-supp-${crypto.randomBytes(3).toString('hex')}`,
      config: {
        channels: {
          email: { apiKey: 're_test_supp', from: 'noreply@test.com' },
        },
      },
    });
    createdTenantIds.push(tenant.id);

    const template = await createTestTemplate(db, tenant.id, {
      subject: 'Hello',
      body: 'Body content',
    });
    const rule = await createTestRule(db, tenant.id, template.id, {
      eventType: 'evt.bounce.flow',
      channel: 'email',
      recipientType: 'static',
      recipientValue: 'bouncer@x.com',
    });

    // 1) Pre-existing notification representing the prior send that bounced.
    const notif = await createTestNotification(db, {
      tenantId: tenant.id,
      eventType: 'evt.bounce.flow',
      eventId: 'evt-pre-bounce',
      recipient: 'bouncer@x.com',
      channel: 'email',
      status: 'sent',
    });

    // 2) Resend posts an email.bounced (hard) webhook.
    const payload = {
      type: 'email.bounced',
      created_at: new Date().toISOString(),
      data: {
        email_id: 'resend_msg_supp',
        bounce: { type: 'hard' },
        to: 'bouncer@x.com',
        headers: {
          'X-Hub-Notification-ID': notif.id,
          'X-Hub-Tenant-ID': tenant.id,
        },
      },
    };
    const rawBody = JSON.stringify(payload);
    const svixId = 'msg_supp';
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

    // 3) Assert: a tenant_suppressions row exists for this tenant + recipient.
    const suppressions = await db
      .select()
      .from(tenantSuppressions)
      .where(
        and(
          eq(tenantSuppressions.tenantId, tenant.id),
          eq(tenantSuppressions.recipient, 'bouncer@x.com'),
        ),
      );
    expect(suppressions.length).toBe(1);
    expect(suppressions[0].reason).toBe('hard_bounce');
    expect(suppressions[0].expiresAt).toBeNull();

    // 4) Send a fresh event to the same recipient. Pipeline must skip it.
    const followUpEvent = {
      tenant_id: tenant.id,
      event_type: 'evt.bounce.flow',
      event_id: `followup-${Date.now()}`,
      payload: {},
      timestamp: new Date().toISOString(),
    };

    await processNotification(db, followUpEvent, rule, 'bouncer@x.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: tenant.config,
    });

    // Resend was NOT called for the follow-up — suppression blocked dispatch
    expect(mockResendSend).not.toHaveBeenCalled();

    const [followUpNotif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, followUpEvent.event_id));
    expect(followUpNotif).toBeDefined();
    expect(followUpNotif.status).toBe('skipped');
    expect(followUpNotif.skipReason).toBe('suppressed');
  });
});
