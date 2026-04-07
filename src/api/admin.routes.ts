import crypto from 'node:crypto';
import fp from 'fastify-plugin';
import { eq } from 'drizzle-orm';
import { tenants } from '../db/schema.js';
import { createTenantSchema, updateTenantSchema } from './schemas.js';
import { ValidationError, NotFoundError } from '../lib/errors.js';
import type { Database } from '../db/client.js';

interface AdminRoutesOptions {
  db: Database;
}

function generateId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${slug}-${suffix}`;
}

function generateApiKey(): string {
  return crypto.randomBytes(24).toString('hex');
}

/** Strip secrets from tenant before sending to client */
function sanitizeTenant(tenant: Record<string, unknown>) {
  const { apiKey, config, ...safe } = tenant;
  // Mask API key — only show last 8 chars
  const maskedKey = typeof apiKey === 'string'
    ? `${'*'.repeat(Math.max(0, apiKey.length - 8))}${apiKey.slice(-8)}`
    : undefined;
  // Strip secret fields from channel configs
  const sanitizedConfig = redactChannelSecrets(config as Record<string, unknown> | null);
  return { ...safe, apiKey: maskedKey, config: sanitizedConfig };
}

function redactChannelSecrets(config: Record<string, unknown> | null): Record<string, unknown> {
  if (!config) return {};
  const channels = config.channels as Record<string, Record<string, unknown>> | undefined;
  if (!channels) return config;

  const redacted: Record<string, Record<string, unknown>> = {};
  for (const [channel, channelConfig] of Object.entries(channels)) {
    redacted[channel] = { ...channelConfig };
    if (redacted[channel].apiKey) redacted[channel].apiKey = '***REDACTED***';
    if (redacted[channel].botToken) redacted[channel].botToken = '***REDACTED***';
  }
  return { ...config, channels: redacted };
}

export const adminRoutes = fp<AdminRoutesOptions>(async (app, opts) => {
  const { db } = opts;

  // POST /api/admin/tenants
  app.post('/api/admin/tenants', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = createTenantSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid tenant data', parsed.error.issues.map((i) => i.message));
    }

    const { name, config } = parsed.data;

    const [tenant] = await db
      .insert(tenants)
      .values({
        id: generateId(name),
        name,
        apiKey: generateApiKey(),
        config: config ?? {},
      })
      .returning();

    return reply.status(201).send({ tenant });
  });

  // GET /api/admin/tenants
  app.get('/api/admin/tenants', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async () => {
    const rows = await db.select().from(tenants);
    return { tenants: rows.map((r) => sanitizeTenant(r as unknown as Record<string, unknown>)) };
  });

  // GET /api/admin/tenants/:id
  app.get<{ Params: { id: string } }>('/api/admin/tenants/:id', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request) => {
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, request.params.id));

    if (!tenant) {
      throw new NotFoundError(`Tenant ${request.params.id} not found`);
    }

    return { tenant: sanitizeTenant(tenant as unknown as Record<string, unknown>) };
  });

  // PUT /api/admin/tenants/:id
  app.put<{ Params: { id: string } }>('/api/admin/tenants/:id', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => {
    const parsed = updateTenantSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid tenant data', parsed.error.issues.map((i) => i.message));
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const data = parsed.data;
    if (data.name !== undefined) updates.name = data.name;
    if (data.config !== undefined) updates.config = data.config;
    if (data.enabled !== undefined) updates.enabled = data.enabled;

    const [tenant] = await db
      .update(tenants)
      .set(updates)
      .where(eq(tenants.id, request.params.id))
      .returning();

    if (!tenant) {
      throw new NotFoundError(`Tenant ${request.params.id} not found`);
    }

    return { tenant: sanitizeTenant(tenant as unknown as Record<string, unknown>) };
  });

  // DELETE /api/admin/tenants/:id
  app.delete<{ Params: { id: string } }>('/api/admin/tenants/:id', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const [tenant] = await db
      .delete(tenants)
      .where(eq(tenants.id, request.params.id))
      .returning();

    if (!tenant) {
      throw new NotFoundError(`Tenant ${request.params.id} not found`);
    }

    return reply.status(204).send();
  });
});
