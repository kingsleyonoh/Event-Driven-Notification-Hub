import fp from 'fastify-plugin';
import { eq, and } from 'drizzle-orm';
import { templates } from '../db/schema.js';
import { createTemplateSchema, updateTemplateSchema, previewTemplateSchema, listTemplatesQuerySchema } from './schemas.js';
import { ValidationError, NotFoundError, ConflictError } from '../lib/errors.js';
import { renderSubjectAndBody } from '../templates/renderer.js';
import type { Database } from '../db/client.js';

interface TemplatesRoutesOptions {
  db: Database;
}

export const templatesRoutes = fp<TemplatesRoutesOptions>(async (app, opts) => {
  const { db } = opts;

  // POST /api/templates
  app.post('/api/templates', async (request, reply) => {
    const parsed = createTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid template data', parsed.error.issues.map((i) => i.message));
    }

    const { name, channel, subject, body, body_text, locale, attachments_config, reply_to, headers } = parsed.data;

    try {
      const [template] = await db
        .insert(templates)
        .values({
          tenantId: request.tenantId,
          name,
          channel,
          subject,
          body,
          bodyText: body_text ?? null,
          locale,
          attachmentsConfig: attachments_config ?? null,
          replyTo: reply_to ?? null,
          headers: headers ?? null,
        })
        .returning();

      return reply.status(201).send({ template });
    } catch (err: unknown) {
      const cause = (err as { cause?: { code?: string } }).cause;
      if (cause?.code === '23505') {
        throw new ConflictError('A template with this name already exists for this tenant');
      }
      throw err;
    }
  });

  // GET /api/templates — Phase 7 H9: optional ?locale=de filter
  app.get('/api/templates', async (request) => {
    const parsed = listTemplatesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      throw new ValidationError('Invalid query', parsed.error.issues.map((i) => i.message));
    }
    const { locale } = parsed.data;

    const where = locale
      ? and(eq(templates.tenantId, request.tenantId), eq(templates.locale, locale))
      : eq(templates.tenantId, request.tenantId);

    const result = await db.select().from(templates).where(where);
    return { templates: result };
  });

  // GET /api/templates/:id
  app.get<{ Params: { id: string } }>('/api/templates/:id', async (request) => {
    const [template] = await db
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.id, request.params.id),
          eq(templates.tenantId, request.tenantId),
        ),
      );

    if (!template) {
      throw new NotFoundError(`Template ${request.params.id} not found`);
    }

    return { template };
  });

  // PUT /api/templates/:id
  app.put<{ Params: { id: string } }>('/api/templates/:id', async (request) => {
    const parsed = updateTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid template data', parsed.error.issues.map((i) => i.message));
    }

    const updates: Record<string, unknown> = {};
    const data = parsed.data;
    if (data.name !== undefined) updates.name = data.name;
    if (data.channel !== undefined) updates.channel = data.channel;
    if (data.subject !== undefined) updates.subject = data.subject;
    if (data.body !== undefined) updates.body = data.body;
    if (data.body_text !== undefined) {
      updates.bodyText = data.body_text;
    }
    if (data.locale !== undefined) {
      updates.locale = data.locale;
    }
    if (data.attachments_config !== undefined) {
      updates.attachmentsConfig = data.attachments_config;
    }
    if (data.reply_to !== undefined) {
      updates.replyTo = data.reply_to;
    }
    if (data.headers !== undefined) {
      updates.headers = data.headers;
    }
    updates.updatedAt = new Date();

    const [template] = await db
      .update(templates)
      .set(updates)
      .where(
        and(
          eq(templates.id, request.params.id),
          eq(templates.tenantId, request.tenantId),
        ),
      )
      .returning();

    if (!template) {
      throw new NotFoundError(`Template ${request.params.id} not found`);
    }

    return { template };
  });

  // DELETE /api/templates/:id
  app.delete<{ Params: { id: string } }>('/api/templates/:id', async (request, reply) => {
    // Check exists first (for 404 vs 409 distinction)
    const [existing] = await db
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.id, request.params.id),
          eq(templates.tenantId, request.tenantId),
        ),
      );

    if (!existing) {
      throw new NotFoundError(`Template ${request.params.id} not found`);
    }

    try {
      await db
        .delete(templates)
        .where(eq(templates.id, request.params.id));
    } catch (err: unknown) {
      const cause = (err as { cause?: { code?: string } }).cause;
      if (cause?.code === '23503') {
        throw new ConflictError('Cannot delete template — it is referenced by one or more rules');
      }
      throw err;
    }

    return reply.status(204).send();
  });

  // POST /api/templates/:id/preview
  app.post<{ Params: { id: string } }>('/api/templates/:id/preview', async (request) => {
    const parsed = previewTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid preview data', parsed.error.issues.map((i) => i.message));
    }

    const [template] = await db
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.id, request.params.id),
          eq(templates.tenantId, request.tenantId),
        ),
      );

    if (!template) {
      throw new NotFoundError(`Template ${request.params.id} not found`);
    }

    const { renderedSubject, renderedBody } = renderSubjectAndBody(
      template.subject,
      template.body,
      parsed.data.payload,
    );

    return {
      rendered_subject: renderedSubject,
      rendered_body: renderedBody,
    };
  });
});
