import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { db, sql } from '../test/setup.js';
import { createTestTenant, createTestPreferences, cleanupTestData } from '../test/factories.js';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { authPlugin } from './middleware/auth.js';
import { preferencesRoutes } from './preferences.routes.js';

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let tenantB: Awaited<ReturnType<typeof createTestTenant>>;

beforeAll(async () => {
  tenant = await createTestTenant(db);
  tenantB = await createTestTenant(db);
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
  await app.register(preferencesRoutes, { db });
  return app;
}

function headers(apiKey?: string) {
  return { 'x-api-key': apiKey ?? tenant.apiKey };
}

describe('Preferences API — PUT /api/preferences/:userId', () => {
  it('creates preferences for a new user', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/preferences/user-new-1',
      headers: headers(),
      payload: {
        email: 'user1@example.com',
        phone: '+15551234567',
        digest_mode: true,
        digest_schedule: 'weekly',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.preferences).toBeDefined();
    expect(body.preferences.userId).toBe('user-new-1');
    expect(body.preferences.email).toBe('user1@example.com');
    expect(body.preferences.phone).toBe('+15551234567');
    expect(body.preferences.digestMode).toBe(true);
    expect(body.preferences.digestSchedule).toBe('weekly');
    expect(body.preferences.tenantId).toBe(tenant.id);
  });

  it('upserts — updates existing preferences', async () => {
    const app = await buildTestApp();
    // Create initial
    await app.inject({
      method: 'PUT',
      url: '/api/preferences/user-upsert',
      headers: headers(),
      payload: { email: 'old@example.com' },
    });

    // Update
    const res = await app.inject({
      method: 'PUT',
      url: '/api/preferences/user-upsert',
      headers: headers(),
      payload: { email: 'new@example.com', digest_mode: true },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.preferences.email).toBe('new@example.com');
    expect(body.preferences.digestMode).toBe(true);
  });

  it('rejects invalid email format', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/preferences/user-bad-email',
      headers: headers(),
      payload: { email: 'not-an-email' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid digest_schedule value', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/preferences/user-bad-schedule',
      headers: headers(),
      payload: { digest_schedule: 'monthly' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid opt_out structure', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/preferences/user-bad-optout',
      headers: headers(),
      payload: { opt_out: 'not-an-object' },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts valid opt_out and quiet_hours JSONB', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/api/preferences/user-jsonb',
      headers: headers(),
      payload: {
        opt_out: { email: ['marketing'], sms: ['all'] },
        quiet_hours: { start: '22:00', end: '08:00', timezone: 'Europe/Berlin' },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.preferences.optOut).toEqual({ email: ['marketing'], sms: ['all'] });
    expect(body.preferences.quietHours).toEqual({ start: '22:00', end: '08:00', timezone: 'Europe/Berlin' });
  });
});

describe('Preferences API — GET /api/preferences/:userId', () => {
  it('returns preferences for existing user', async () => {
    await createTestPreferences(db, tenant.id, 'user-get-1', {
      email: 'get1@example.com',
      digestMode: true,
    });

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/preferences/user-get-1',
      headers: headers(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.preferences.userId).toBe('user-get-1');
    expect(body.preferences.email).toBe('get1@example.com');
    expect(body.preferences.digestMode).toBe(true);
  });

  it('returns 404 for unknown user', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/preferences/nonexistent-user',
      headers: headers(),
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('enforces tenant isolation — tenant A cannot read tenant B preferences', async () => {
    await createTestPreferences(db, tenantB.id, 'isolated-user', {
      email: 'secret@tenantb.com',
    });

    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/preferences/isolated-user',
      headers: headers(tenant.apiKey), // tenant A key
    });

    expect(res.statusCode).toBe(404);
  });
});
