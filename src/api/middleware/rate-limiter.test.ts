import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { rateLimiterPlugin } from './rate-limiter.js';
import { errorHandlerPlugin } from './error-handler.js';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  await app.register(rateLimiterPlugin);

  app.get('/api/test', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, async () => {
    return { ok: true };
  });

  return app;
}

describe('rate limiter middleware', () => {
  it('allows requests under the limit', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/test' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('returns 429 when rate limit is exceeded', async () => {
    const app = await buildTestApp();

    // Exhaust the limit (3 requests)
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'GET', url: '/api/test' });
    }

    // 4th request should be rate limited
    const response = await app.inject({ method: 'GET', url: '/api/test' });

    expect(response.statusCode).toBe(429);
  });

  it('includes rate limit headers in responses', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/test' });

    expect(response.headers['x-ratelimit-limit']).toBeDefined();
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
  });
});
