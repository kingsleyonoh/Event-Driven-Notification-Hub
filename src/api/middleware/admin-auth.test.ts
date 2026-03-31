import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { adminAuthPlugin } from './admin-auth.js';
import { errorHandlerPlugin } from './error-handler.js';

const ADMIN_KEY = 'test-admin-key-secret';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(adminAuthPlugin, { adminApiKey: ADMIN_KEY });

  app.get('/api/admin/test', async () => {
    return { admin: true };
  });

  return app;
}

describe('admin auth middleware', () => {
  it('allows requests with valid admin key', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/test',
      headers: { 'x-admin-key': ADMIN_KEY },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ admin: true });
  });

  it('rejects requests with missing admin key', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/test',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects requests with invalid admin key', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/test',
      headers: { 'x-admin-key': 'wrong-key' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });
});
