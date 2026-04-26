import fp from 'fastify-plugin';
import { eq, and, sql as sqlOp } from 'drizzle-orm';
import { tenantSuppressions } from '../db/schema.js';
import {
  createSuppressionSchema,
  listSuppressionsQuerySchema,
} from './schemas.js';
import { ValidationError, NotFoundError } from '../lib/errors.js';
import type { Database } from '../db/client.js';

interface SuppressionsRoutesOptions {
  db: Database;
}

interface CursorShape {
  // PG-native text representation of created_at (microsecond precision preserved
  // — JS Date.toISOString() only gives millisecond precision, which causes false
  // misses on tuple comparison when many rows share the same transaction
  // timestamp).
  createdAtText: string;
  id: string;
}

function encodeCursor(row: { createdAtText: string; id: string }): string {
  const payload: CursorShape = {
    createdAtText: row.createdAtText,
    id: row.id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): CursorShape | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as CursorShape;
    if (
      typeof parsed.createdAtText !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export const suppressionsRoutes = fp<SuppressionsRoutesOptions>(async (app, opts) => {
  const { db } = opts;

  // POST /api/suppressions — manual block
  app.post('/api/suppressions', async (request, reply) => {
    const parsed = createSuppressionSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid suppression data',
        parsed.error.issues.map((i) => i.message),
      );
    }

    const { recipient, reason, expires_at } = parsed.data;
    const expiresAt = expires_at ? new Date(expires_at) : null;

    // ON CONFLICT (tenant_id, recipient) DO NOTHING — returns no row on conflict.
    const inserted = await db
      .insert(tenantSuppressions)
      .values({
        tenantId: request.tenantId,
        recipient,
        reason,
        expiresAt,
      })
      .onConflictDoNothing({
        target: [tenantSuppressions.tenantId, tenantSuppressions.recipient],
      })
      .returning();

    if (inserted.length > 0) {
      return reply.status(201).send({ suppression: inserted[0] });
    }

    // Conflict — fetch and return existing row with 200
    const [existing] = await db
      .select()
      .from(tenantSuppressions)
      .where(
        and(
          eq(tenantSuppressions.tenantId, request.tenantId),
          eq(tenantSuppressions.recipient, recipient),
        ),
      )
      .limit(1);

    return reply.status(200).send({ suppression: existing });
  });

  // DELETE /api/suppressions/:id — tenant-scoped
  app.delete<{ Params: { id: string } }>(
    '/api/suppressions/:id',
    async (request, reply) => {
      const deleted = await db
        .delete(tenantSuppressions)
        .where(
          and(
            eq(tenantSuppressions.id, request.params.id),
            eq(tenantSuppressions.tenantId, request.tenantId),
          ),
        )
        .returning();

      if (deleted.length === 0) {
        throw new NotFoundError(`Suppression ${request.params.id} not found`);
      }

      return reply.status(204).send();
    },
  );

  // GET /api/suppressions — cursor-paginated list (per Pattern 006)
  app.get('/api/suppressions', async (request) => {
    const parsed = listSuppressionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid query parameters',
        parsed.error.issues.map((i) => i.message),
      );
    }

    const { cursor, limit } = parsed.data;

    const conditions = [eq(tenantSuppressions.tenantId, request.tenantId)];

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (!decoded) {
        throw new ValidationError('Invalid cursor', ['cursor: malformed or expired']);
      }
      // Tuple comparison using the cursor's PG-text timestamp (preserves
      // microsecond precision; cast back to timestamptz for type-safe
      // comparison against the column).
      conditions.push(
        sqlOp`(${tenantSuppressions.createdAt}, ${tenantSuppressions.id}) < (${decoded.createdAtText}::timestamp, ${decoded.id}::uuid)`,
      );
    }

    const rows = await db
      .select({
        id: tenantSuppressions.id,
        tenantId: tenantSuppressions.tenantId,
        recipient: tenantSuppressions.recipient,
        reason: tenantSuppressions.reason,
        expiresAt: tenantSuppressions.expiresAt,
        createdAt: tenantSuppressions.createdAt,
        // Microsecond-precise text form for cursor encoding
        createdAtText: sqlOp<string>`to_char(${tenantSuppressions.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`.as('created_at_text'),
      })
      .from(tenantSuppressions)
      .where(and(...conditions))
      .orderBy(
        sqlOp`${tenantSuppressions.createdAt} DESC`,
        sqlOp`${tenantSuppressions.id} DESC`,
      )
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && trimmed.length > 0
        ? encodeCursor({
            createdAtText: trimmed[trimmed.length - 1].createdAtText,
            id: trimmed[trimmed.length - 1].id,
          })
        : null;

    // Strip the cursor-helper column from the response payload.
    const data = trimmed.map(({ createdAtText: _, ...rest }) => rest);

    return { data, nextCursor };
  });
});
