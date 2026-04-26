import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import { tenants } from '../db/schema.js';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { adminAuthPlugin } from './middleware/admin-auth.js';
import { adminRoutes } from './admin.routes.js';

const ADMIN_KEY = 'test-admin-key-secret';
const createdTenantIds: string[] = [];

beforeAll(async () => {});

afterAll(async () => {
  for (const id of createdTenantIds) {
    await db.delete(tenants).where(eq(tenants.id, id));
  }
  await sql.end();
});

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(adminAuthPlugin, { adminApiKey: ADMIN_KEY });
  await app.register(adminRoutes, { db });
  return app;
}

function adminHeaders() {
  return { 'x-admin-key': ADMIN_KEY };
}

describe('Admin Tenants API — Authentication', () => {
  it('rejects request with missing admin key', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/tenants',
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects request with invalid admin key', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/tenants',
      headers: { 'x-admin-key': 'wrong-key' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('Admin Tenants API — CRUD', () => {
  it('POST /api/admin/tenants — creates tenant with auto-generated API key', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
      payload: { name: 'Integration Test Tenant' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tenant).toBeDefined();
    expect(body.tenant.name).toBe('Integration Test Tenant');
    expect(body.tenant.apiKey).toBeDefined();
    expect(typeof body.tenant.apiKey).toBe('string');
    expect(body.tenant.apiKey.length).toBeGreaterThan(16);
    expect(body.tenant.enabled).toBe(true);
    expect(body.tenant.id).toBeDefined();
    createdTenantIds.push(body.tenant.id);
  });

  it('POST /api/admin/tenants — returns one-time delivery_callback_secret + suppresses on GET', async () => {
    const app = await buildTestApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
      payload: { name: 'Callback Secret Tenant' },
    });

    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    // 32-byte hex secret returned ONCE on create.
    expect(created.tenant.deliveryCallbackSecret).toBeDefined();
    expect(typeof created.tenant.deliveryCallbackSecret).toBe('string');
    expect(created.tenant.deliveryCallbackSecret).toMatch(/^[0-9a-f]{64}$/);
    createdTenantIds.push(created.tenant.id);

    // GET must NOT return the secret — sanitizer strips it.
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/admin/tenants/${created.tenant.id}`,
      headers: adminHeaders(),
    });
    expect(getRes.statusCode).toBe(200);
    const fetched = getRes.json();
    expect(fetched.tenant.deliveryCallbackSecret).toBeUndefined();
  });

  it('POST /api/admin/tenants — rejects missing name', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/admin/tenants — accepts optional config', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
      payload: { name: 'Configured Tenant', config: { dedup_window: 30 } },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.tenant.config).toEqual({ dedup_window: 30 });
    createdTenantIds.push(body.tenant.id);
  });

  it('GET /api/admin/tenants — lists all tenants', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.tenants)).toBe(true);
    expect(body.tenants.length).toBeGreaterThanOrEqual(2); // at least the two created above
  });

  it('GET /api/admin/tenants/:id — returns single tenant', async () => {
    const id = createdTenantIds[0];
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/admin/tenants/${id}`,
      headers: adminHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenant.id).toBe(id);
    expect(body.tenant.name).toBe('Integration Test Tenant');
  });

  it('GET /api/admin/tenants/:id — returns 404 for unknown id', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/tenants/nonexistent-tenant',
      headers: adminHeaders(),
    });

    expect(res.statusCode).toBe(404);
  });

  it('PUT /api/admin/tenants/:id — updates tenant fields', async () => {
    const id = createdTenantIds[0];
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/tenants/${id}`,
      headers: adminHeaders(),
      payload: { name: 'Updated Name', enabled: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenant.name).toBe('Updated Name');
    expect(body.tenant.enabled).toBe(false);
  });

  it('PATCH /api/admin/tenants/:id/rate-limit — updates events_per_minute (Phase 7 H7)', async () => {
    const app = await buildTestApp();
    // Create a tenant for rate-limit patching
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
      payload: { name: 'RL Patch Tenant' },
    });
    const tenantId = createRes.json().tenant.id;
    createdTenantIds.push(tenantId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tenants/${tenantId}/rate-limit`,
      headers: adminHeaders(),
      payload: { events_per_minute: 50 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenant.config.rate_limits.events_per_minute).toBe(50);
    // Sanitizer must still strip secrets
    expect(body.tenant.deliveryCallbackSecret).toBeUndefined();
  });

  it('PATCH /api/admin/tenants/:id/rate-limit — preserves other config keys', async () => {
    const app = await buildTestApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
      payload: {
        name: 'RL Preserve Tenant',
        config: { dedup_window: 30, channels: { email: { apiKey: 'k', from: 'f@x.com' } } },
      },
    });
    const tenantId = createRes.json().tenant.id;
    createdTenantIds.push(tenantId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tenants/${tenantId}/rate-limit`,
      headers: adminHeaders(),
      payload: { events_per_minute: 75 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tenant.config.rate_limits.events_per_minute).toBe(75);
    expect(body.tenant.config.dedup_window).toBe(30);
    // Channels preserved (secrets redacted by sanitizer)
    expect(body.tenant.config.channels?.email).toBeDefined();
  });

  it('PATCH /api/admin/tenants/:id/rate-limit — rejects events_per_minute below 1', async () => {
    const app = await buildTestApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
      payload: { name: 'RL Range Tenant' },
    });
    const tenantId = createRes.json().tenant.id;
    createdTenantIds.push(tenantId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tenants/${tenantId}/rate-limit`,
      headers: adminHeaders(),
      payload: { events_per_minute: 0 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /api/admin/tenants/:id/rate-limit — rejects events_per_minute above 1000', async () => {
    const app = await buildTestApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
      payload: { name: 'RL Cap Tenant' },
    });
    const tenantId = createRes.json().tenant.id;
    createdTenantIds.push(tenantId);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/tenants/${tenantId}/rate-limit`,
      headers: adminHeaders(),
      payload: { events_per_minute: 1001 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('PATCH /api/admin/tenants/:id/rate-limit — 404 for unknown tenant', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/admin/tenants/nonexistent-tenant/rate-limit',
      headers: adminHeaders(),
      payload: { events_per_minute: 50 },
    });

    expect(res.statusCode).toBe(404);
  });

  // Phase 7 7b — tenant config schema validation at WRITE time.
  it('POST /api/admin/tenants — rejects malformed channels.email config (missing apiKey)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
      payload: {
        name: 'Bad Config Tenant',
        config: { channels: { email: { from: 'noreply@x.com' } } }, // missing apiKey
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/admin/tenants — rejects rate_limits over 1000', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
      payload: {
        name: 'Excessive RL Tenant',
        config: { rate_limits: { events_per_minute: 99999 } },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/admin/tenants — accepts valid full Phase 7 config', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
      payload: {
        name: 'Valid Phase 7 Tenant',
        config: {
          channels: {
            email: {
              apiKey: 're_test_xx',
              from: 'noreply@valid.com',
              replyTo: 'support@valid.com',
              sandbox: true,
              fromDomains: [{ domain: 'valid.com', default: true }],
            },
          },
          rate_limits: { events_per_minute: 250 },
        },
      },
    });

    expect(res.statusCode).toBe(201);
    createdTenantIds.push(res.json().tenant.id);
  });

  it('PUT /api/admin/tenants/:id — rejects malformed config on update', async () => {
    const app = await buildTestApp();
    // Create a clean tenant
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
      payload: { name: 'Update Validation Tenant' },
    });
    const tenantId = createRes.json().tenant.id;
    createdTenantIds.push(tenantId);

    const res = await app.inject({
      method: 'PUT',
      url: `/api/admin/tenants/${tenantId}`,
      headers: adminHeaders(),
      payload: {
        config: { channels: { telegram: { botUsername: 'NoToken' } } }, // missing botToken
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('DELETE /api/admin/tenants/:id — removes tenant', async () => {
    // Create a tenant specifically for deletion
    const app = await buildTestApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/tenants',
      headers: adminHeaders(),
      payload: { name: 'To Be Deleted' },
    });
    const deleteId = createRes.json().tenant.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/admin/tenants/${deleteId}`,
      headers: adminHeaders(),
    });

    expect(res.statusCode).toBe(204);

    // Verify it's gone
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/admin/tenants/${deleteId}`,
      headers: adminHeaders(),
    });
    expect(getRes.statusCode).toBe(404);
  });
});
