import fp from 'fastify-plugin';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { tenants } from '../../db/schema.js';
import { UnauthorizedError } from '../../lib/errors.js';
import type { Database } from '../../db/client.js';

export interface TenantRecord {
  id: string;
  name: string;
  apiKey: string;
  config: Record<string, unknown> | null;
  enabled: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    tenantId: string;
    tenant: TenantRecord;
  }
}

const PUBLIC_ROUTES = ['/api/health'];
const PUBLIC_PREFIXES = ['/ws/', '/api/admin', '/api/webhooks/'];

interface AuthPluginOptions {
  db: Database;
}

export const authPlugin = fp<AuthPluginOptions>(async (app, opts) => {
  const { db } = opts;

  app.decorateRequest('tenantId', '');
  app.decorateRequest('tenant', null as unknown as TenantRecord);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (PUBLIC_ROUTES.includes(request.url)) {
      return;
    }

    if (PUBLIC_PREFIXES.some((prefix) => request.url.startsWith(prefix))) {
      return;
    }

    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      throw new UnauthorizedError('Missing API key');
    }

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.apiKey, apiKey))
      .limit(1);

    if (!tenant) {
      throw new UnauthorizedError('Invalid API key');
    }

    if (!tenant.enabled) {
      throw new UnauthorizedError('Tenant is disabled');
    }

    request.tenantId = tenant.id;
    request.tenant = tenant as TenantRecord;
  });
});
