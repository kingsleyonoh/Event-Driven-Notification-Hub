import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { db, sql } from '../test/setup.js';
import { createTestTenant, cleanupTestData } from '../test/factories.js';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { rateLimiterPlugin } from './middleware/rate-limiter.js';
import { authPlugin } from './middleware/auth.js';
import { eventsRoutes } from './events.routes.js';

let tenantA: Awaited<ReturnType<typeof createTestTenant>>;
let tenantB: Awaited<ReturnType<typeof createTestTenant>>;

beforeAll(async () => {
  tenantA = await createTestTenant(db, {
    config: { rate_limits: { events_per_minute: 10 } },
  });
  tenantB = await createTestTenant(db, {
    config: { rate_limits: { events_per_minute: 100 } },
  });
});

afterAll(async () => {
  await cleanupTestData(db, tenantA.id);
  await cleanupTestData(db, tenantB.id);
  await sql.end();
});

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(rateLimiterPlugin);
  await app.register(authPlugin, { db });
  await app.register(eventsRoutes, {
    db,
    useKafka: false,
    pipelineConfig: {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily' as const,
      dispatch: {},
    },
  });
  return app;
}

describe('POST /api/events — per-tenant rate limit', () => {
  it('tenant A with events_per_minute=10 blocks the 11th request', async () => {
    const app = await buildTestApp();

    // First 10 requests must succeed
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/events',
        headers: { 'x-api-key': tenantA.apiKey },
        payload: {
          event_type: 'test.ratelimit',
          event_id: `tenantA-evt-${i}`,
          payload: { i },
        },
      });
      expect(res.statusCode).toBe(200);
    }

    // 11th request must be rate-limited
    const res = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { 'x-api-key': tenantA.apiKey },
      payload: {
        event_type: 'test.ratelimit',
        event_id: 'tenantA-evt-11',
        payload: {},
      },
    });

    expect(res.statusCode).toBe(429);
    const body = res.json();
    expect(body.error.code).toBe('RATE_LIMITED');
  });

  it('tenant B with events_per_minute=100 does NOT block the 11th request (per-tenant scoping)', async () => {
    const app = await buildTestApp();

    // 11 requests for tenant B — none should be rate-limited
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/events',
        headers: { 'x-api-key': tenantB.apiKey },
        payload: {
          event_type: 'test.ratelimit',
          event_id: `tenantB-evt-${i}`,
          payload: { i },
        },
      });
      expect(res.statusCode).toBe(200);
    }
  });
});
