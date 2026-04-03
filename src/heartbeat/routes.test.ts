import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import { createTestTenant, cleanupTestData } from '../test/factories.js';
import { heartbeats } from '../db/schema.js';
import { errorHandlerPlugin } from '../api/middleware/error-handler.js';
import { authPlugin } from '../api/middleware/auth.js';
import { heartbeatRoutes } from './routes.js';

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let tenantB: Awaited<ReturnType<typeof createTestTenant>>;

beforeAll(async () => {
  tenant = await createTestTenant(db);
  tenantB = await createTestTenant(db);
});

afterAll(async () => {
  await db.delete(heartbeats).where(eq(heartbeats.tenantId, tenant.id));
  await db.delete(heartbeats).where(eq(heartbeats.tenantId, tenantB.id));
  await cleanupTestData(db, tenant.id);
  await cleanupTestData(db, tenantB.id);
  await sql.end();
});

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, { db });
  await app.register(heartbeatRoutes, { db });
  return app;
}

function headers(apiKey?: string) {
  return { 'x-api-key': apiKey ?? tenant.apiKey };
}

describe('Heartbeat API — POST /api/heartbeats', () => {
  it('registers a new heartbeat', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/heartbeats',
      headers: headers(),
      payload: { source_name: 'price-scraper', interval_minutes: 60 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.heartbeat).toBeDefined();
    expect(body.heartbeat.sourceName).toBe('price-scraper');
    expect(body.heartbeat.intervalMinutes).toBe(60);
    expect(body.heartbeat.lastSeenAt).toBeDefined();
    expect(body.heartbeat.alertedAt).toBeNull();
    expect(body.heartbeat.tenantId).toBe(tenant.id);
  });

  it('pulses existing heartbeat — updates lastSeenAt, clears alertedAt', async () => {
    const app = await buildTestApp();

    // Manually set alertedAt to simulate a previous alert
    await db
      .update(heartbeats)
      .set({ alertedAt: new Date('2020-01-01') })
      .where(eq(heartbeats.sourceName, 'price-scraper'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/heartbeats',
      headers: headers(),
      payload: { source_name: 'price-scraper' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.heartbeat.alertedAt).toBeNull();
    // lastSeenAt should be recent (within last 5s)
    const lastSeen = new Date(body.heartbeat.lastSeenAt);
    expect(Date.now() - lastSeen.getTime()).toBeLessThan(5000);
  });

  it('rejects missing source_name', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/heartbeats',
      headers: headers(),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Heartbeat API — GET /api/heartbeats', () => {
  it('lists heartbeats scoped to tenant', async () => {
    // Create a heartbeat for tenant B — should not appear
    const app = await buildTestApp();
    await app.inject({
      method: 'POST',
      url: '/api/heartbeats',
      headers: headers(tenantB.apiKey),
      payload: { source_name: 'secret-service' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/heartbeats',
      headers: headers(tenant.apiKey),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.heartbeats)).toBe(true);
    expect(body.heartbeats.every((h: { tenantId: string }) => h.tenantId === tenant.id)).toBe(true);
  });
});

describe('Heartbeat API — DELETE /api/heartbeats/:id', () => {
  it('removes a heartbeat', async () => {
    const app = await buildTestApp();

    // Create one to delete
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/heartbeats',
      headers: headers(),
      payload: { source_name: 'to-delete' },
    });
    const id = createRes.json().heartbeat.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/heartbeats/${id}`,
      headers: headers(),
    });

    expect(res.statusCode).toBe(204);
  });

  it('returns 404 for unknown id', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/heartbeats/00000000-0000-0000-0000-000000000000',
      headers: headers(),
    });

    expect(res.statusCode).toBe(404);
  });
});
