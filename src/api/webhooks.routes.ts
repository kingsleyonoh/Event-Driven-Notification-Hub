import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { emailDeliveryEvents, notifications, tenantSuppressions } from '../db/schema.js';
import { verifyResendSignature } from './webhooks-resend-verify.js';
import {
  dispatchDeliveryCallback,
  type DeliveryCallbackEvent,
} from '../channels/delivery-callback.js';
import { createLogger } from '../lib/logger.js';
import type { Database } from '../db/client.js';

const logger = createLogger('webhooks');

interface WebhookRoutesOptions {
  db: Database;
  /** Resend webhook signing secret (whsec_... format). */
  webhookSecret?: string;
}

/**
 * Resend webhook event payload shape (subset we care about).
 *
 * `data.headers` carries any custom headers we passed to Resend at send
 * time — we use `X-Hub-Notification-ID` and `X-Hub-Tenant-ID` to correlate
 * the event back to the originating notification row (see `src/channels/email.ts`).
 */
interface ResendWebhookPayload {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    headers?: Record<string, string> | Array<{ name: string; value: string }>;
    [k: string]: unknown;
  };
}

/**
 * Resend webhook → INSERT into `email_delivery_events`, UPDATE matching
 * `notifications` row, fire delivery callback (fire-and-forget).
 *
 * PUBLIC route — no `X-API-Key`. Signature verified per-request via
 * `verifyResendSignature` against `RESEND_WEBHOOK_SECRET`.
 */
export const webhookRoutes: FastifyPluginAsync<WebhookRoutesOptions> = async (app, opts) => {
  const { db, webhookSecret } = opts;

  // CRITICAL — this plugin is registered WITHOUT `fastify-plugin` (`fp`)
  // wrapping. That was a Phase 7.6 regression fix (smoke-test 2026-04-26):
  // `fp()` BREAKS encapsulation so the `addContentTypeParser` below would
  // override the default JSON parser globally, breaking every other JSON POST
  // route in the app with "Request body size did not match Content-Length".
  // Encapsulation MUST be preserved here so the raw-body parser stays scoped
  // to the webhook route only.
  //
  // Override JSON parser for this plugin scope to retain the raw body.
  // Resend's Svix signature is computed over the exact bytes of the request
  // body — we MUST verify against the raw string before any reserialization.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        const parsed = body.length > 0 ? JSON.parse(body as string) : {};
        // Stash raw body on the parsed object so the handler can access it.
        // Fastify gives us the parsed body in `request.body`; the raw bytes
        // are not retained by default. We attach via a non-enumerable field
        // on the parsed object.
        Object.defineProperty(parsed, '__rawBody', {
          value: body,
          enumerable: false,
        });
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.post('/api/webhooks/resend', {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const headers: Record<string, string | undefined> = {
      'svix-id': asString(request.headers['svix-id']),
      'svix-timestamp': asString(request.headers['svix-timestamp']),
      'svix-signature': asString(request.headers['svix-signature']),
    };

    const body = (request.body ?? {}) as ResendWebhookPayload & { __rawBody?: string };
    const rawBody = body.__rawBody ?? '';

    if (!webhookSecret) {
      logger.error('RESEND_WEBHOOK_SECRET not configured — rejecting webhook');
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'webhook secret not configured', details: [] } });
    }

    if (!verifyResendSignature(rawBody, headers, webhookSecret)) {
      logger.warn({ svixId: headers['svix-id'] }, 'Resend webhook signature verification failed');
      return reply.status(401).send({ error: { code: 'UNAUTHORIZED', message: 'invalid signature', details: [] } });
    }

    const eventType = body.type;
    const data = body.data ?? {};
    const resendEmailId = typeof data.email_id === 'string' ? data.email_id : null;

    if (!eventType || !resendEmailId) {
      logger.warn({ eventType, hasEmailId: !!resendEmailId }, 'Resend webhook missing type or email_id');
      // Still 200 — Resend retries on non-2xx; malformed payloads are user-error not transport.
      return reply.status(200).send({ received: true, ignored: true });
    }

    // Correlate back to our notification via custom headers we set at send time.
    const customHeaders = normalizeHeaders(data.headers);
    const notificationId = customHeaders['x-hub-notification-id'] ?? null;
    const tenantId = customHeaders['x-hub-tenant-id'] ?? null;

    // If we have a tenant-id from the headers, use it. Otherwise we cannot
    // tenant-scope the row — for now, drop the event with a warning (matching
    // the H4 spec note that batch 013 will handle the cross-tenant lookup case).
    if (!tenantId) {
      logger.warn({ resendEmailId, eventType }, 'Resend webhook missing X-Hub-Tenant-ID — cannot tenant-scope event');
      return reply.status(200).send({ received: true, ignored: true });
    }

    // INSERT the audit row.
    await db.insert(emailDeliveryEvents).values({
      tenantId,
      notificationId,
      resendEmailId,
      eventType,
      rawPayload: body as unknown as Record<string, unknown>,
    });

    // UPDATE the notification row's status / delivered_at / bounce_type.
    if (notificationId) {
      await applyNotificationStateFromEvent(db, tenantId, notificationId, eventType, body);
    }

    // Phase 7 H10 — auto-add to tenant_suppressions on hard bounce / complaint.
    // Idempotent via UNIQUE(tenant_id, recipient) + ON CONFLICT DO NOTHING.
    const suppressionReason = suppressionReasonFor(eventType, body);
    if (suppressionReason) {
      const recipient = await resolveBounceRecipient(db, tenantId, notificationId, body);
      if (recipient) {
        await db
          .insert(tenantSuppressions)
          .values({
            tenantId,
            recipient: recipient.toLowerCase(),
            reason: suppressionReason,
          })
          .onConflictDoNothing({
            target: [tenantSuppressions.tenantId, tenantSuppressions.recipient],
          });
        logger.info(
          { tenantId, recipient, reason: suppressionReason },
          'tenant_suppressions row inserted (or kept) from webhook',
        );
      } else {
        logger.warn(
          { tenantId, eventType, notificationId },
          'cannot resolve recipient for suppression — skipping',
        );
      }
    }

    // Fire-and-forget callback dispatch — never await; never block the 200.
    const callbackEvent: DeliveryCallbackEvent = {
      event_type: eventType,
      resend_email_id: resendEmailId,
      notification_id: notificationId,
      payload: body,
      created_at: typeof body.created_at === 'string'
        ? body.created_at
        : new Date().toISOString(),
    };
    void dispatchDeliveryCallback(db, tenantId, callbackEvent).catch((err) => {
      logger.warn(
        { tenantId, resendEmailId, err: err instanceof Error ? err.message : String(err) },
        'delivery callback dispatch threw',
      );
    });

    return reply.status(200).send({ received: true });
  });
};

/**
 * Mutate the notification row to reflect a Resend delivery event.
 * Tenant-scoped by `(tenant_id, id)` so cross-tenant headers can never
 * mutate another tenant's notification.
 */
async function applyNotificationStateFromEvent(
  db: Database,
  tenantId: string,
  notificationId: string,
  eventType: string,
  body: ResendWebhookPayload,
): Promise<void> {
  const updates: Record<string, unknown> = {};
  switch (eventType) {
    case 'email.delivered': {
      const created = typeof body.created_at === 'string' ? new Date(body.created_at) : new Date();
      updates.deliveredAt = created;
      break;
    }
    case 'email.bounced': {
      updates.status = 'failed';
      const bounceType = extractBounceType(body);
      if (bounceType) updates.bounceType = bounceType;
      updates.errorMessage = `bounce: ${bounceType ?? 'unknown'}`;
      break;
    }
    case 'email.complained': {
      updates.status = 'failed';
      updates.skipReason = 'complaint';
      updates.errorMessage = 'recipient complaint';
      break;
    }
    case 'email.delivery_delayed': {
      // No status change — Resend will retry. We just record the audit row.
      return;
    }
    default:
      return;
  }
  if (Object.keys(updates).length === 0) return;

  await db
    .update(notifications)
    .set(updates)
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.id, notificationId)));
}

/**
 * Phase 7 H10 — decide whether the webhook event should auto-add the recipient
 * to the tenant suppression list.
 *
 * - `email.bounced` is suppressed ONLY when the bounce is "hard" (per Resend's
 *   `data.bounce.type` or `data.bounce_type`). Soft bounces are transient.
 *   We treat `'hard'` and any string starting with `hard_` as hard.
 * - `email.complained` always suppresses (recipient marked the email as spam).
 *
 * Returns the suppression reason string, or null when the event should NOT
 * trigger a suppression.
 */
function suppressionReasonFor(
  eventType: string,
  body: ResendWebhookPayload,
): 'hard_bounce' | 'complaint' | null {
  if (eventType === 'email.complained') return 'complaint';
  if (eventType === 'email.bounced') {
    const bounceType = extractBounceType(body) ?? '';
    const lower = bounceType.toLowerCase();
    if (lower === 'hard' || lower.startsWith('hard')) return 'hard_bounce';
    return null;
  }
  return null;
}

/**
 * Resolve the recipient email for a bounce/complaint webhook. Tries:
 * 1. The `data.to` field on the Resend payload (string or first array entry).
 * 2. The notification row's `recipient` (looked up via the X-Hub-Notification-ID
 *    header). Tenant-scoped to prevent cross-tenant reads.
 */
async function resolveBounceRecipient(
  db: Database,
  tenantId: string,
  notificationId: string | null,
  body: ResendWebhookPayload,
): Promise<string | null> {
  const data = body.data as Record<string, unknown> | undefined;
  if (data) {
    const to = data.to;
    if (typeof to === 'string' && to.length > 0) return to;
    if (Array.isArray(to) && to.length > 0 && typeof to[0] === 'string') {
      return to[0] as string;
    }
  }
  if (notificationId) {
    const [row] = await db
      .select({ recipient: notifications.recipient })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.id, notificationId),
        ),
      )
      .limit(1);
    if (row?.recipient) return row.recipient;
  }
  return null;
}

function extractBounceType(body: ResendWebhookPayload): string | null {
  const data = body.data as Record<string, unknown> | undefined;
  if (!data) return null;
  const bounce = data.bounce as Record<string, unknown> | undefined;
  if (bounce && typeof bounce.type === 'string') return bounce.type;
  if (typeof data.bounce_type === 'string') return data.bounce_type;
  return null;
}

/**
 * Resend may emit headers either as a flat object or as an array of
 * `{name, value}` entries. Normalize to lowercased-key flat object.
 */
function normalizeHeaders(
  raw: Record<string, string> | Array<{ name: string; value: string }> | undefined,
): Record<string, string> {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const out: Record<string, string> = {};
    for (const entry of raw) {
      if (entry && typeof entry.name === 'string' && typeof entry.value === 'string') {
        out[entry.name.toLowerCase()] = entry.value;
      }
    }
    return out;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k.toLowerCase()] = v;
  }
  return out;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
