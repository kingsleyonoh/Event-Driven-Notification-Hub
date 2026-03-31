import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { db, sql } from '../../test/setup.js';
import { tenants } from '../../db/schema.js';
import { authPlugin } from './auth.js';
import { errorHandlerPlugin } from './error-handler.js';

const TEST_TENANT = {
  id: 'test-auth-tenant',
  name: 'Auth Test Tenant',
  apiKey: 'test-auth-key-12345',
};

const DISABLED_TENANT = {
  id: 'test-disabled-tenant',
  name: 'Disabled Tenant',
  apiKey: 'test-disabled-key-99999',
  enabled: false,
};

beforeAll(async () => {
  await db.insert(tenants).values(TEST_TENANT);
  await db.insert(tenants).values(DISABLED_TENANT);
});

afterAll(async () => {
  await db.delete(tenants).where(eq(tenants.id, TEST_TENANT.id));
  await db.delete(tenants).where(eq(tenants.id, DISABLED_TENANT.id));
  await sql.end();
});

async function buildTestApp() {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, { db });

  app.get('/api/test', async (request) => {
    return {
      tenantId: request.tenantId,
      tenantName: request.tenant.name,
    };
  });

  app.get('/api/health', async () => {
    return { status: 'ok' };
  });

  return app;
}

describe('auth middleware', () => {
  it('authenticates with a valid API key and injects tenant context', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { 'x-api-key': TEST_TENANT.apiKey },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.tenantId).toBe(TEST_TENANT.id);
    expect(body.tenantName).toBe(TEST_TENANT.name);
  });

  it('rejects requests with missing API key', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/test',
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects requests with invalid API key', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { 'x-api-key': 'nonexistent-key' },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects requests for disabled tenants', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { 'x-api-key': DISABLED_TENANT.apiKey },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('allows public routes without API key', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
