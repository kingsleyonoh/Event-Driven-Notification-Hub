import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { db, sql } from '../test/setup.js';
import { createTestTenant, createTestTemplate, createTestRule, cleanupTestData } from '../test/factories.js';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { authPlugin } from './middleware/auth.js';
import { rulesRoutes } from './rules.routes.js';

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let template: Awaited<ReturnType<typeof createTestTemplate>>;

beforeAll(async () => {
  tenant = await createTestTenant(db);
  template = await createTestTemplate(db, tenant.id);
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, { db });
  await app.register(rulesRoutes, { db });
  return app;
}

function headers() {
  return { 'x-api-key': tenant.apiKey };
}

describe('Rules CRUD API', () => {
  let createdRuleId: string;

  it('POST /api/rules — creates a rule', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/rules',
      headers: headers(),
      payload: {
        event_type: 'order.completed',
        channel: 'email',
        template_id: template.id,
        recipient_type: 'static',
        recipient_value: 'admin@example.com',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.rule).toBeDefined();
    expect(body.rule.eventType).toBe('order.completed');
    expect(body.rule.channel).toBe('email');
    expect(body.rule.templateId).toBe(template.id);
    expect(body.rule.urgency).toBe('normal');
    expect(body.rule.enabled).toBe(true);
    expect(body.rule.tenantId).toBe(tenant.id);
    createdRuleId = body.rule.id;
  });

  it('POST /api/rules — rejects invalid payload', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/rules',
      headers: headers(),
      payload: {
        event_type: '',
        channel: 'pigeon',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/rules — rejects duplicate rule', async () => {
    const app = await buildTestApp();
    // Create first
    await app.inject({
      method: 'POST',
      url: '/api/rules',
      headers: headers(),
      payload: {
        event_type: 'dup.test',
        channel: 'sms',
        template_id: template.id,
        recipient_type: 'static',
        recipient_value: 'dup@example.com',
      },
    });

    // Duplicate
    const response = await app.inject({
      method: 'POST',
      url: '/api/rules',
      headers: headers(),
      payload: {
        event_type: 'dup.test',
        channel: 'sms',
        template_id: template.id,
        recipient_type: 'static',
        recipient_value: 'dup@example.com',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
  });

  it('GET /api/rules — lists rules for tenant', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/rules',
      headers: headers(),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.rules).toBeInstanceOf(Array);
    expect(body.rules.length).toBeGreaterThanOrEqual(1);
    // All rules belong to this tenant
    for (const rule of body.rules) {
      expect(rule.tenantId).toBe(tenant.id);
    }
  });

  it('GET /api/rules/:id — returns a single rule', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: `/api/rules/${createdRuleId}`,
      headers: headers(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().rule.id).toBe(createdRuleId);
  });

  it('GET /api/rules/:id — returns 404 for nonexistent rule', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/rules/00000000-0000-0000-0000-000000000000',
      headers: headers(),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('PUT /api/rules/:id — updates a rule', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'PUT',
      url: `/api/rules/${createdRuleId}`,
      headers: headers(),
      payload: {
        urgency: 'critical',
        enabled: false,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.rule.urgency).toBe('critical');
    expect(body.rule.enabled).toBe(false);
  });

  it('PUT /api/rules/:id — returns 404 for nonexistent rule', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/rules/00000000-0000-0000-0000-000000000000',
      headers: headers(),
      payload: { urgency: 'high' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('DELETE /api/rules/:id — deletes a rule', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/rules/${createdRuleId}`,
      headers: headers(),
    });

    expect(response.statusCode).toBe(204);

    // Confirm deleted
    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/rules/${createdRuleId}`,
      headers: headers(),
    });
    expect(getResponse.statusCode).toBe(404);
  });

  it('DELETE /api/rules/:id — returns 404 for nonexistent rule', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/rules/00000000-0000-0000-0000-000000000000',
      headers: headers(),
    });

    expect(response.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/rules',
    });

    expect(response.statusCode).toBe(401);
  });
});
