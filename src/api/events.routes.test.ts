import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { db, sql } from '../test/setup.js';
import { createTestTenant, cleanupTestData } from '../test/factories.js';
import { errorHandlerPlugin } from './middleware/error-handler.js';
import { rateLimiterPlugin } from './middleware/rate-limiter.js';
import { authPlugin } from './middleware/auth.js';
import { eventsRoutes } from './events.routes.js';
import { disconnectProducer, resetKafkaClient } from '../consumer/producer.js';

const KAFKA_BROKERS = ['localhost:19092'];

let tenant: Awaited<ReturnType<typeof createTestTenant>>;

beforeAll(async () => {
  tenant = await createTestTenant(db);
});

afterAll(async () => {
  await disconnectProducer();
  resetKafkaClient();
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(rateLimiterPlugin);
  await app.register(authPlugin, { db });
  await app.register(eventsRoutes, {
    kafkaBrokers: KAFKA_BROKERS,
    kafkaTopics: 'events.notifications',
  });
  return app;
}

describe('POST /api/events', () => {
  it('publishes a test event to Kafka', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { 'x-api-key': tenant.apiKey },
      payload: {
        event_type: 'test.ping',
        event_id: 'test-evt-001',
        payload: { message: 'hello' },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ published: true });
  });

  it('rejects invalid event payload', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/events',
      headers: { 'x-api-key': tenant.apiKey },
      payload: {
        event_type: '',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication', async () => {
    const app = await buildTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/events',
      payload: {
        event_type: 'test.ping',
        event_id: 'test-evt-002',
        payload: {},
      },
    });

    expect(response.statusCode).toBe(401);
  });
});
