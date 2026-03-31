import { describe, it, expect, afterAll } from 'vitest';
import Fastify from 'fastify';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { healthRoutes } from './health.routes.js';
import { db, sql } from '../test/setup.js';

afterAll(async () => {
  await sql.end();
});

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(healthRoutes, {
    db,
    kafkaBrokers: ['localhost:19092'],
    resendApiKey: 're_test_key',
  });
  return app;
}

describe('GET /api/health', () => {
  it('returns status with pg and kafka checks passing', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.pg).toBe(true);
    expect(body.kafka).toBe(true);
    // resend depends on network — status is ok or degraded accordingly
    expect(['ok', 'degraded']).toContain(body.status);
  });

  it('returns degraded when a service is unreachable', async () => {
    const app = Fastify({ logger: false });
    await app.register(errorHandlerPlugin);
    await app.register(healthRoutes, {
      db,
      kafkaBrokers: ['localhost:19999'], // bad port
      resendApiKey: 're_test_key',
    });

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    const body = response.json();
    expect(body.status).toBe('degraded');
    expect(body.pg).toBe(true);
    expect(body.kafka).toBe(false);
  });

  it('returns response with all expected fields', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    const body = response.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('pg');
    expect(body).toHaveProperty('kafka');
    expect(body).toHaveProperty('resend');
  });
});
