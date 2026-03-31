import fp from 'fastify-plugin';
import { eq, and } from 'drizzle-orm';
import { notificationRules } from '../db/schema.js';
import { createRuleSchema, updateRuleSchema } from './schemas.js';
import { ValidationError, NotFoundError, ConflictError } from '../lib/errors.js';
import type { Database } from '../db/client.js';

interface RulesRoutesOptions {
  db: Database;
}

export const rulesRoutes = fp<RulesRoutesOptions>(async (app, opts) => {
  const { db } = opts;

  // POST /api/rules
  app.post('/api/rules', async (request, reply) => {
    const parsed = createRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid rule data', parsed.error.issues.map((i) => i.message));
    }

    const { event_type, channel, template_id, recipient_type, recipient_value, urgency, enabled } =
      parsed.data;

    try {
      const [rule] = await db
        .insert(notificationRules)
        .values({
          tenantId: request.tenantId,
          eventType: event_type,
          channel,
          templateId: template_id,
          recipientType: recipient_type,
          recipientValue: recipient_value,
          urgency,
          enabled,
        })
        .returning();

      return reply.status(201).send({ rule });
    } catch (err: unknown) {
      const cause = (err as { cause?: { code?: string } }).cause;
      if (cause?.code === '23505') {
        throw new ConflictError('A rule with this event_type, channel, and recipient already exists');
      }
      throw err;
    }
  });

  // GET /api/rules
  app.get('/api/rules', async (request) => {
    const rules = await db
      .select()
      .from(notificationRules)
      .where(eq(notificationRules.tenantId, request.tenantId));

    return { rules };
  });

  // GET /api/rules/:id
  app.get<{ Params: { id: string } }>('/api/rules/:id', async (request) => {
    const [rule] = await db
      .select()
      .from(notificationRules)
      .where(
        and(
          eq(notificationRules.id, request.params.id),
          eq(notificationRules.tenantId, request.tenantId),
        ),
      );

    if (!rule) {
      throw new NotFoundError(`Rule ${request.params.id} not found`);
    }

    return { rule };
  });

  // PUT /api/rules/:id
  app.put<{ Params: { id: string } }>('/api/rules/:id', async (request) => {
    const parsed = updateRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid rule data', parsed.error.issues.map((i) => i.message));
    }

    const updates: Record<string, unknown> = {};
    const data = parsed.data;
    if (data.event_type !== undefined) updates.eventType = data.event_type;
    if (data.channel !== undefined) updates.channel = data.channel;
    if (data.template_id !== undefined) updates.templateId = data.template_id;
    if (data.recipient_type !== undefined) updates.recipientType = data.recipient_type;
    if (data.recipient_value !== undefined) updates.recipientValue = data.recipient_value;
    if (data.urgency !== undefined) updates.urgency = data.urgency;
    if (data.enabled !== undefined) updates.enabled = data.enabled;
    updates.updatedAt = new Date();

    const [rule] = await db
      .update(notificationRules)
      .set(updates)
      .where(
        and(
          eq(notificationRules.id, request.params.id),
          eq(notificationRules.tenantId, request.tenantId),
        ),
      )
      .returning();

    if (!rule) {
      throw new NotFoundError(`Rule ${request.params.id} not found`);
    }

    return { rule };
  });

  // DELETE /api/rules/:id
  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (request, reply) => {
    const [rule] = await db
      .delete(notificationRules)
      .where(
        and(
          eq(notificationRules.id, request.params.id),
          eq(notificationRules.tenantId, request.tenantId),
        ),
      )
      .returning();

    if (!rule) {
      throw new NotFoundError(`Rule ${request.params.id} not found`);
    }

    return reply.status(204).send();
  });
});
