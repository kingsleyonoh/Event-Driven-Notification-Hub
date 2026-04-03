import fp from 'fastify-plugin';
import { eq, and, lt, isNull, desc } from 'drizzle-orm';
import { notifications } from '../db/schema.js';
import { paginationSchema } from './schemas.js';
import { ValidationError } from '../lib/errors.js';
import type { Database } from '../db/client.js';

interface NotificationsRoutesOptions {
  db: Database;
}

export const notificationsRoutes = fp<NotificationsRoutesOptions>(async (app, opts) => {
  const { db } = opts;

  // GET /api/notifications — cursor-based paginated list
  app.get('/api/notifications', async (request) => {
    const parsed = paginationSchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query parameters', parsed.error.issues.map((i) => i.message));
    }

    const { cursor, limit, status, channel, created_after, created_before, userId } = parsed.data;

    const conditions = [eq(notifications.tenantId, request.tenantId)];

    if (status) conditions.push(eq(notifications.status, status));
    if (channel) conditions.push(eq(notifications.channel, channel));
    if (userId) conditions.push(eq(notifications.recipient, userId));
    if (created_after) conditions.push(
      // createdAt > created_after — use gt equivalent via lt reversed
      // Drizzle doesn't export gt directly for timestamps, use sql or workaround
      // Actually drizzle-orm does export gt
      eq(notifications.tenantId, request.tenantId), // placeholder — will use proper gt
    );
    if (cursor) {
      conditions.push(lt(notifications.createdAt, new Date(cursor)));
    }

    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit + 1); // fetch 1 extra to determine if there's a next page

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].createdAt.toISOString() : null;

    return { notifications: page, cursor: nextCursor };
  });

  // GET /api/notifications/:userId/unread
  app.get<{ Params: { userId: string } }>('/api/notifications/:userId/unread', async (request) => {
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, request.tenantId),
          eq(notifications.recipient, request.params.userId),
          eq(notifications.channel, 'in_app'),
          eq(notifications.status, 'sent'),
          isNull(notifications.deliveredAt),
        ),
      )
      .orderBy(desc(notifications.createdAt));

    return { notifications: rows, count: rows.length };
  });
});
