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

export const adminRoutes = fp<AdminRoutesOptions>(async (app, opts) => {
  const { db } = opts;

  // POST /api/admin/tenants
  app.post('/api/admin/tenants', async (request, reply) => {
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
  app.get('/api/admin/tenants', async () => {
    const rows = await db.select().from(tenants);
    return { tenants: rows };
  });

  // GET /api/admin/tenants/:id
  app.get<{ Params: { id: string } }>('/api/admin/tenants/:id', async (request) => {
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, request.params.id));

    if (!tenant) {
      throw new NotFoundError(`Tenant ${request.params.id} not found`);
    }

    return { tenant };
  });

  // PUT /api/admin/tenants/:id
  app.put<{ Params: { id: string } }>('/api/admin/tenants/:id', async (request) => {
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

    return { tenant };
  });

  // DELETE /api/admin/tenants/:id
  app.delete<{ Params: { id: string } }>('/api/admin/tenants/:id', async (request, reply) => {
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
