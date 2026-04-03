import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { db, sql } from '../test/setup.js';
import {
  createTestTenant, createTestTemplate, createTestRule,
  createTestNotification, cleanupTestData,
} from '../test/factories.js';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { authPlugin } from './middleware/auth.js';
import { notificationsRoutes } from './notifications.routes.js';

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let tenantB: Awaited<ReturnType<typeof createTestTenant>>;
let template: Awaited<ReturnType<typeof createTestTemplate>>;
let rule: Awaited<ReturnType<typeof createTestRule>>;

beforeAll(async () => {
  tenant = await createTestTenant(db);
  tenantB = await createTestTenant(db);
  template = await createTestTemplate(db, tenant.id);
  rule = await createTestRule(db, tenant.id, template.id);

  // Seed notifications for listing tests
  for (let i = 0; i < 5; i++) {
    await createTestNotification(db, {
      tenantId: tenant.id,
      ruleId: rule.id,
      eventType: 'test.event',
      eventId: `list-evt-${i}`,
      recipient: 'list-user',
      channel: 'email',
      status: 'sent',
    });
  }

  // Seed in_app notifications for unread tests
  await createTestNotification(db, {
    tenantId: tenant.id,
    ruleId: rule.id,
    eventType: 'test.event',
    eventId: 'unread-1',
    recipient: 'unread-user',
    channel: 'in_app',
    status: 'sent',
  });
  await createTestNotification(db, {
    tenantId: tenant.id,
    ruleId: rule.id,
    eventType: 'test.event',
    eventId: 'unread-2',
    recipient: 'unread-user',
    channel: 'in_app',
    status: 'sent',
  });
  // This one is delivered — should NOT appear in unread
  await createTestNotification(db, {
    tenantId: tenant.id,
    ruleId: rule.id,
    eventType: 'test.event',
    eventId: 'read-1',
    recipient: 'unread-user',
    channel: 'in_app',
    status: 'sent',
    deliveredAt: new Date(),
  });
  // This one is email — should NOT appear in unread
  await createTestNotification(db, {
    tenantId: tenant.id,
    ruleId: rule.id,
    eventType: 'test.event',
    eventId: 'email-1',
    recipient: 'unread-user',
    channel: 'email',
    status: 'sent',
  });

  // Seed a notification for tenant B (isolation test)
  const tmplB = await createTestTemplate(db, tenantB.id);
  const ruleB = await createTestRule(db, tenantB.id, tmplB.id);
  await createTestNotification(db, {
    tenantId: tenantB.id,
    ruleId: ruleB.id,
    eventType: 'secret.event',
    eventId: 'secret-evt-1',
    recipient: 'secret-user',
    channel: 'email',
    status: 'sent',
  });
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await cleanupTestData(db, tenantB.id);
  await sql.end();
});

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, { db });
  await app.register(notificationsRoutes, { db });
  return app;
}

function headers(apiKey?: string) {
  return { 'x-api-key': apiKey ?? tenant.apiKey };
}

describe('Notifications API — GET /api/notifications', () => {
  it('returns paginated notification list', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/notifications',
      headers: headers(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notifications).toBeDefined();
    expect(Array.isArray(body.notifications)).toBe(true);
    expect(body.notifications.length).toBeGreaterThanOrEqual(5);
  });

  it('filters by status', async () => {
    // Add a skipped notification
    await createTestNotification(db, {
      tenantId: tenant.id,
      ruleId: rule.id,
      eventType: 'test.event',
      eventId: `skipped-filter-${Date.now()}`,
      recipient: 'filter-user',
      channel: 'email',
      status: 'skipped',
      skipReason: 'opt_out',
    });

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/notifications?status=skipped',
      headers: headers(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notifications.length).toBeGreaterThanOrEqual(1);
    expect(body.notifications.every((n: { status: string }) => n.status === 'skipped')).toBe(true);
  });

  it('filters by channel', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/notifications?channel=in_app',
      headers: headers(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notifications.every((n: { channel: string }) => n.channel === 'in_app')).toBe(true);
  });

  it('cursor pagination returns next page', async () => {
    const app = await buildTestApp();

    // First page with limit 2
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/notifications?limit=2',
      headers: headers(),
    });
    const page1 = res1.json();
    expect(page1.notifications.length).toBe(2);
    expect(page1.cursor).toBeDefined();

    // Second page using cursor
    const res2 = await app.inject({
      method: 'GET',
      url: `/api/notifications?limit=2&cursor=${page1.cursor}`,
      headers: headers(),
    });
    const page2 = res2.json();
    expect(page2.notifications.length).toBeGreaterThanOrEqual(1);

    // Pages should not overlap
    const ids1 = page1.notifications.map((n: { id: string }) => n.id);
    const ids2 = page2.notifications.map((n: { id: string }) => n.id);
    const overlap = ids1.filter((id: string) => ids2.includes(id));
    expect(overlap.length).toBe(0);
  });

  it('respects limit with max 100', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/notifications?limit=999',
      headers: headers(),
    });

    // Should clamp or reject — the schema defaults max to 100
    // Zod coerce with .max(100) will fail validation
    expect(res.statusCode).toBe(400);
  });

  it('enforces tenant isolation', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/notifications',
      headers: headers(tenant.apiKey),
    });

    const body = res.json();
    const tenantIds = body.notifications.map((n: { tenantId: string }) => n.tenantId);
    expect(tenantIds.every((id: string) => id === tenant.id)).toBe(true);
  });
});

describe('Notifications API — GET /api/notifications/:userId/unread', () => {
  it('returns unread in_app notifications for user', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/notifications/unread-user/unread',
      headers: headers(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notifications).toBeDefined();
    expect(body.count).toBe(2); // 2 unread in_app, not the delivered one or email one
    expect(body.notifications.every((n: { channel: string }) => n.channel === 'in_app')).toBe(true);
    expect(body.notifications.every((n: { deliveredAt: unknown }) => n.deliveredAt === null)).toBe(true);
  });

  it('returns empty list for user with no unread', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/notifications/no-notifs-user/unread',
      headers: headers(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.notifications).toEqual([]);
    expect(body.count).toBe(0);
  });
});
