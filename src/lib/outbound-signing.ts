import crypto from 'node:crypto';

/**
 * Phase 7 7b — shared HMAC-SHA256 signing for ALL Hub→tenant outbound
 * callbacks. Originally extracted from `delivery-callback.ts` (Phase 7 H4)
 * so future outbound paths (suppression notifications, generic webhook
 * fan-out, alert callbacks) reuse the same canonical-JSON + signature
 * scheme — see Pattern 010.
 *
 * Contract for tenants verifying our signatures:
 *   1. Read raw request body bytes (do NOT re-stringify a parsed object —
 *      JSON re-encoding will produce different bytes and the HMAC will
 *      mismatch).
 *   2. HMAC-SHA256 those bytes with the tenant's `*_callback_secret` (the
 *      one returned at tenant create alongside `apiKey`).
 *   3. Compare hex digest with the value after `sha256=` in the
 *      `X-Hub-Signature` header. Use a constant-time comparison.
 *
 * The Hub's side: we always sign the canonical-JSON form (sorted keys,
 * recursive) so tenants who reconstruct the body from a parsed JSON can
 * arrive at the same bytes by canonicalizing on their side. Most tenants
 * however just hash the raw bytes received — that's simpler and works.
 */

/**
 * Canonicalize an arbitrary JSON-able value into bytes that are stable
 * across re-encoding: sort object keys recursively, leave primitives /
 * arrays as-is. Does NOT support Map / Set / Date / BigInt — outbound
 * callback payloads are intentionally pure JSON.
 */
export function canonicalJson(value: unknown): string {
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
 * HMAC-SHA256 sign the canonical-JSON form of an event using the given
 * secret. Returns lowercase hex digest (no `sha256=` prefix). Pure
 * function — same inputs always produce the same output.
 */
export function signOutboundPayload(event: unknown, secret: string): string {
  const canonical = canonicalJson(event);
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

/**
 * Build the canonical body + the matching `X-Hub-Signature` header value
 * for an outbound callback. The body and signature MUST be returned
 * together so the same canonical bytes get sent over the wire AND signed
 * (any re-stringification between sign and send is where signature/body
 * mismatch bugs creep in — see gotcha 2026-04-25 if/when this happens).
 *
 * Header format: `sha256=<hex-digest>` (matches GitHub / Slack / similar
 * conventions).
 */
export function buildSignedOutboundRequest(
  event: unknown,
  secret: string,
): { body: string; signatureHeader: string } {
  const body = canonicalJson(event);
  const digest = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return { body, signatureHeader: `sha256=${digest}` };
}
