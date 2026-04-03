import fp from 'fastify-plugin';
import { eq, and } from 'drizzle-orm';
import { heartbeats } from '../db/schema.js';
import { upsertHeartbeatSchema } from '../api/schemas.js';
import { ValidationError, NotFoundError } from '../lib/errors.js';
import type { Database } from '../db/client.js';

interface HeartbeatRoutesOptions {
  db: Database;
}

export const heartbeatRoutes = fp<HeartbeatRoutesOptions>(async (app, opts) => {
  const { db } = opts;

  // POST /api/heartbeats — register or pulse
  app.post('/api/heartbeats', async (request) => {
    const parsed = upsertHeartbeatSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid heartbeat data', parsed.error.issues.map((i) => i.message));
    }

    const { source_name, interval_minutes } = parsed.data;
    const now = new Date();

    const [hb] = await db
      .insert(heartbeats)
      .values({
        tenantId: request.tenantId,
        sourceName: source_name,
        intervalMinutes: interval_minutes ?? 240,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [heartbeats.tenantId, heartbeats.sourceName],
        set: {
          lastSeenAt: now,
          alertedAt: null,
          updatedAt: now,
          ...(interval_minutes !== undefined ? { intervalMinutes: interval_minutes } : {}),
        },
      })
      .returning();

    return { heartbeat: hb };
  });

  // GET /api/heartbeats
  app.get('/api/heartbeats', async (request) => {
    const rows = await db
      .select()
      .from(heartbeats)
      .where(eq(heartbeats.tenantId, request.tenantId));

    return { heartbeats: rows };
  });

  // DELETE /api/heartbeats/:id
  app.delete<{ Params: { id: string } }>('/api/heartbeats/:id', async (request, reply) => {
    const [hb] = await db
      .delete(heartbeats)
      .where(
        and(
          eq(heartbeats.id, request.params.id),
          eq(heartbeats.tenantId, request.tenantId),
        ),
      )
      .returning();

    if (!hb) {
      throw new NotFoundError(`Heartbeat ${request.params.id} not found`);
    }

    return reply.status(204).send();
  });
});
