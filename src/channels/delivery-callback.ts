import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { tenants, emailDeliveryEvents } from '../db/schema.js';
import { resolveTenantChannelConfig } from '../lib/channel-config.js';
import { createLogger } from '../lib/logger.js';
import type { Database } from '../db/client.js';

const logger = createLogger('delivery-callback');

const REQUEST_TIMEOUT_MS = 5_000;

/**
 * Shape of the JSON body POSTed to a tenant's `deliveryCallbackUrl`.
 * `payload` is the raw Resend webhook body (kept opaque to avoid leaking
 * Resend-specific shape changes into the callback contract — tenants
 * decode the parts they care about).
 */
export interface DeliveryCallbackEvent {
  event_type: string;
  resend_email_id: string;
  notification_id: string | null;
  payload: unknown;
  /** ISO 8601 timestamp of the original delivery event (Resend's `created_at`). */
  created_at: string;
}

/**
 * Canonical JSON: stable key ordering at every level so that two equal
 * objects always produce byte-identical JSON. This is essential for
 * HMAC signing — non-deterministic stringification would mean the
 * tenant computes a different signature than we do for the same logical
 * payload.
 *
 * Recurses into plain objects and arrays. Leaves primitives untouched.
 * Does NOT support Maps/Sets/Date/BigInt — webhook payloads are pure
 * JSON anyway.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => {
    const v = (value as Record<string, unknown>)[k];
    return JSON.stringify(k) + ':' + canonicalJson(v);
  });
  return '{' + parts.join(',') + '}';
}

/**
 * Pure helper: HMAC-SHA256 sign the canonical JSON of an event using the
 * tenant's `delivery_callback_secret`. Returns lowercase hex digest.
 *
 * Exported for direct testing (signing is the load-bearing security bit;
 * we want deterministic tests without needing to mock fetch).
 */
export function signPayload(event: DeliveryCallbackEvent, secret: string): string {
  const canonical = canonicalJson(event);
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

/**
 * Build the canonical body + matching signature header for an event.
 * Returned together so the same canonical bytes get sent over the wire
 * AND signed (we never re-stringify between sign and send — that path
 * is where signature/body mismatches creep in).
 */
function buildSignedRequest(
  event: DeliveryCallbackEvent,
  secret: string,
): { body: string; signatureHeader: string } {
  const body = canonicalJson(event);
  const digest = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return { body, signatureHeader: `sha256=${digest}` };
}

/**
 * Update `email_delivery_events.callback_status_code` for the matching
 * event row. The webhook handler INSERTs the row before triggering this
 * callback, so it must exist by the time we get here. We scope by
 * `(tenant_id, resend_email_id, event_type)` to avoid bleeding statuses
 * across tenants or event types. Failure to update is logged but never
 * throws (caller's contract: don't block).
 */
async function updateCallbackStatus(
  db: Database,
  tenantId: string,
  resendEmailId: string,
  eventType: string,
  statusCode: number | null,
): Promise<void> {
  try {
    await db
      .update(emailDeliveryEvents)
      .set({ callbackStatusCode: statusCode })
      .where(
        and(
          eq(emailDeliveryEvents.tenantId, tenantId),
          eq(emailDeliveryEvents.resendEmailId, resendEmailId),
          eq(emailDeliveryEvents.eventType, eventType),
        ),
      );
  } catch (err) {
    logger.warn(
      {
        tenantId,
        resendEmailId,
        eventType,
        err: err instanceof Error ? err.message : String(err),
      },
      'failed to update email_delivery_events.callback_status_code',
    );
  }
}

/**
 * Fire-and-log delivery callback to a tenant's `deliveryCallbackUrl`.
 *
 * - If the tenant has no callback URL OR no `delivery_callback_secret`
 *   configured, returns silently (callback is opt-in).
 * - On non-2xx response or transport error, logs a warning and updates
 *   `email_delivery_events.callback_status_code`. NEVER throws to the
 *   caller — webhook handler must always return 200 to Resend.
 * - 5s request timeout via AbortController.
 */
export async function dispatchDeliveryCallback(
  db: Database,
  tenantId: string,
  event: DeliveryCallbackEvent,
): Promise<void> {
  const [tenant] = await db
    .select({
      config: tenants.config,
      secret: tenants.deliveryCallbackSecret,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId));

  if (!tenant) {
    logger.warn({ tenantId }, 'delivery callback skipped — tenant not found');
    return;
  }

  const emailConfig = resolveTenantChannelConfig(tenant.config, 'email');
  const callbackUrl = (emailConfig as { deliveryCallbackUrl?: string } | null)
    ?.deliveryCallbackUrl;
  const secret = tenant.secret;

  if (!callbackUrl || !secret) {
    // Callback is opt-in — silent skip is correct.
    return;
  }

  const { body, signatureHeader } = buildSignedRequest(event, secret);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let statusCode: number | null = null;
  try {
    const res = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature': signatureHeader,
      },
      body,
      signal: controller.signal,
    });
    statusCode = res.status;
    if (!res.ok) {
      logger.warn(
        {
          tenantId,
          resendEmailId: event.resend_email_id,
          eventType: event.event_type,
          statusCode,
        },
        'delivery callback returned non-2xx',
      );
    }
  } catch (err) {
    logger.warn(
      {
        tenantId,
        resendEmailId: event.resend_email_id,
        eventType: event.event_type,
        err: err instanceof Error ? err.message : String(err),
      },
      'delivery callback request failed',
    );
    // statusCode stays null — network error has no HTTP status.
  } finally {
    clearTimeout(timer);
  }

  await updateCallbackStatus(
    db,
    tenantId,
    event.resend_email_id,
    event.event_type,
    statusCode,
  );
}
