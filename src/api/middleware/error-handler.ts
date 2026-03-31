import fp from 'fastify-plugin';
import type { FastifyError } from 'fastify';
import { AppError, toErrorResponse } from '../../lib/errors.js';

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((error: FastifyError | AppError | Error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(toErrorResponse(error));
    }

    // @fastify/rate-limit errors
    if ('statusCode' in error && error.statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded',
          details: [],
        },
      });
    }

    // Fastify validation errors (from schema validation)
    if ('validation' in error && error.validation) {
      const details = (error as FastifyError).validation!.map(
        (v: { instancePath?: string; message?: string }) =>
          `${v.instancePath || '/'}: ${v.message}`,
      );
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details,
        },
      });
    }

    // Unknown errors — don't leak internals
    app.log.error(error);
    return reply.status(500).send(toErrorResponse(error));
  });
});
