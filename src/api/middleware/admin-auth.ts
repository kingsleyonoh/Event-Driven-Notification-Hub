import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../../lib/errors.js';

interface AdminAuthPluginOptions {
  adminApiKey: string;
}

export const adminAuthPlugin = fp<AdminAuthPluginOptions>(async (app, opts) => {
  const { adminApiKey } = opts;

  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (!request.url.startsWith('/api/admin')) {
      return;
    }

    const key = request.headers['x-admin-key'] as string | undefined;

    if (!key) {
      throw new UnauthorizedError('Missing admin API key');
    }

    if (key !== adminApiKey) {
      throw new UnauthorizedError('Invalid admin API key');
    }
  });
});
