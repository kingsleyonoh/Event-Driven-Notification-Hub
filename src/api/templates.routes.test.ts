import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { db, sql } from '../test/setup.js';
import { createTestTenant, createTestTemplate, createTestRule, cleanupTestData } from '../test/factories.js';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { authPlugin } from './middleware/auth.js';
import { templatesRoutes } from './templates.routes.js';

let tenant: Awaited<ReturnType<typeof createTestTenant>>;

beforeAll(async () => {
  tenant = await createTestTenant(db);
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, { db });
  await app.register(templatesRoutes, { db });
  return app;
}

function headers() {
  return { 'x-api-key': tenant.apiKey };
}

describe('Templates CRUD API', () => {
  let createdTemplateId: string;

  it('POST /api/templates — creates a template', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: headers(),
      payload: {
        name: 'order-shipped',
        channel: 'email',
        subject: 'Order {{orderId}} shipped',
        body: 'Hi {{name}}, your order has shipped.',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.template.name).toBe('order-shipped');
    expect(body.template.channel).toBe('email');
    expect(body.template.tenantId).toBe(tenant.id);
    createdTemplateId = body.template.id;
  });

  it('POST /api/templates — rejects __ prefixed names', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: headers(),
      payload: {
        name: '__system-reserved',
        channel: 'email',
        body: 'test',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/templates — rejects duplicate name per tenant', async () => {
    const app = await buildTestApp();
    // First create
    await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: headers(),
      payload: { name: 'dup-name', channel: 'sms', body: 'first' },
    });

    // Duplicate
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: headers(),
      payload: { name: 'dup-name', channel: 'email', body: 'second' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
  });

  it('GET /api/templates — lists templates for tenant', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/templates',
      headers: headers(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.templates).toBeInstanceOf(Array);
    expect(body.templates.length).toBeGreaterThanOrEqual(1);
    for (const t of body.templates) {
      expect(t.tenantId).toBe(tenant.id);
    }
  });

  it('GET /api/templates/:id — returns a single template', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/templates/${createdTemplateId}`,
      headers: headers(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().template.id).toBe(createdTemplateId);
  });

  it('GET /api/templates/:id — returns 404 for nonexistent', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/templates/00000000-0000-0000-0000-000000000000',
      headers: headers(),
    });

    expect(response.statusCode).toBe(404);
  });

  it('PUT /api/templates/:id — updates a template', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/templates/${createdTemplateId}`,
      headers: headers(),
      payload: { body: 'Updated body content' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().template.body).toBe('Updated body content');
  });

  it('PUT /api/templates/:id — returns 404 for nonexistent', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/templates/00000000-0000-0000-0000-000000000000',
      headers: headers(),
      payload: { body: 'new' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('DELETE /api/templates/:id — deletes a template', async () => {
    // Create a disposable template
    const app = await buildTestApp();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/templates',
      headers: headers(),
      payload: { name: 'to-delete', channel: 'in_app', body: 'bye' },
    });
    const deleteId = createRes.json().template.id;

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${deleteId}`,
      headers: headers(),
    });

    expect(response.statusCode).toBe(204);
  });

  it('DELETE /api/templates/:id — returns 409 if template used by a rule', async () => {
    // Create template + rule referencing it
    const tmpl = await createTestTemplate(db, tenant.id, { name: 'used-by-rule' });
    await createTestRule(db, tenant.id, tmpl.id);

    const app = await buildTestApp();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/templates/${tmpl.id}`,
      headers: headers(),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
  });

  it('DELETE /api/templates/:id — returns 404 for nonexistent', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/templates/00000000-0000-0000-0000-000000000000',
      headers: headers(),
    });

    expect(response.statusCode).toBe(404);
  });

  it('POST /api/templates/:id/preview — renders template with payload', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: `/api/templates/${createdTemplateId}/preview`,
      headers: headers(),
      payload: {
        payload: { orderId: '999', name: 'TestUser' },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.rendered_subject).toBe('Order 999 shipped');
    // Body was updated by PUT test to 'Updated body content' (static text, no variables)
    expect(body.rendered_body).toBe('Updated body content');
  });

  it('POST /api/templates/:id/preview — returns 404 for nonexistent', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/templates/00000000-0000-0000-0000-000000000000/preview',
      headers: headers(),
      payload: { payload: {} },
    });

    expect(response.statusCode).toBe(404);
  });
});
