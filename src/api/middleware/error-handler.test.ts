import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  RateLimitedError,
  InternalError,
} from '../../lib/errors.js';
import { errorHandlerPlugin } from './error-handler.js';

async function buildTestApp() {
  const app = Fastify({ logger: false });
  await app.register(errorHandlerPlugin);
  return app;
}

describe('error handler middleware', () => {
  it('formats ValidationError as 400 with standard shape', async () => {
    const app = await buildTestApp();
    app.get('/test', () => {
      throw new ValidationError('bad input', ['name is required']);
    });

    const response = await app.inject({ method: 'GET', url: '/test' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'bad input',
        details: ['name is required'],
      },
    });
  });

  it('formats NotFoundError as 404', async () => {
    const app = await buildTestApp();
    app.get('/test', () => {
      throw new NotFoundError('rule not found');
    });

    const response = await app.inject({ method: 'GET', url: '/test' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('formats ConflictError as 409', async () => {
    const app = await buildTestApp();
    app.get('/test', () => {
      throw new ConflictError('duplicate name');
    });

    const response = await app.inject({ method: 'GET', url: '/test' });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
  });

  it('formats UnauthorizedError as 401', async () => {
    const app = await buildTestApp();
    app.get('/test', () => {
      throw new UnauthorizedError('invalid key');
    });

    const response = await app.inject({ method: 'GET', url: '/test' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('formats RateLimitedError as 429', async () => {
    const app = await buildTestApp();
    app.get('/test', () => {
      throw new RateLimitedError('too many requests');
    });

    const response = await app.inject({ method: 'GET', url: '/test' });

    expect(response.statusCode).toBe(429);
    expect(response.json().error.code).toBe('RATE_LIMITED');
  });

  it('formats InternalError as 500', async () => {
    const app = await buildTestApp();
    app.get('/test', () => {
      throw new InternalError('something broke');
    });

    const response = await app.inject({ method: 'GET', url: '/test' });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.code).toBe('INTERNAL_ERROR');
  });

  it('formats unknown errors as 500 INTERNAL_ERROR without leaking details', async () => {
    const app = await buildTestApp();
    app.get('/test', () => {
      throw new Error('secret database connection string exposed');
    });

    const response = await app.inject({ method: 'GET', url: '/test' });

    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
    expect(body.error.details).toEqual([]);
  });
});
