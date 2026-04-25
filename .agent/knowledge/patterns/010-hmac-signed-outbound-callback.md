# 010 — HMAC-Signed Outbound Tenant Callback

## Problem

When the Hub POSTs an event to a tenant-supplied URL (delivery callbacks, suppression-list callbacks, future webhooks), the tenant needs a way to verify the request actually came from the Hub and wasn't crafted by an attacker who guessed the URL. PRD §7b mandates HMAC signing on **all** outbound tenant callbacks — not just delivery callbacks (H4). This pattern captures the canonical shape so every future callback follows the same recipe.

## Pattern

1. **Per-tenant secret column.** Mint a 32-byte hex secret on tenant create alongside `apiKey`. Stored in `tenants.delivery_callback_secret` (or a parallel column for future callback families). Returned in the create-response **once**; never logged; never returned by `GET /tenants/:id`.
2. **Canonical JSON.** Stringify the event payload with **stable key ordering at every level** (recursive sort). Two equal logical objects must produce byte-identical JSON. Without this, the tenant's verification HMAC won't match ours. Implementation: `canonicalJson(value)` in `src/channels/delivery-callback.ts`.
3. **HMAC-SHA256.** `crypto.createHmac('sha256', secret).update(canonicalBytes).digest('hex')`. Lowercase hex.
4. **Send canonical bytes verbatim.** Compute the HMAC over the canonical string AND send that exact string as the request body. Don't re-stringify between sign and send (a spurious whitespace difference would break verification on the tenant side).
5. **Header shape.** `X-Hub-Signature: sha256=<hex>` (matches GitHub's webhook convention; tenants already know how to verify it).
6. **5s timeout via `AbortController`.** Tenants who go slow shouldn't block the webhook handler.
7. **Never block on failure.** Log the warning, persist the HTTP status (or NULL on network error) to the audit table, and return void. Webhook handlers must always 200 to Resend; suppression handlers must never deadlock other tenants.

## Pure helper exported for testing

Factor `signPayload(event, secret): string` as a pure function. Tests sign a fixed payload with two different secrets, assert the digests differ; sign twice with the same secret, assert equality. No HTTP mocks needed — the security primitive is verifiable in isolation.

## Reference implementation

`src/channels/delivery-callback.ts` (Phase 7 H4). Subsequent callbacks (suppression-list updates per H10, generic event callbacks per 7b) should reuse `canonicalJson()` + `signPayload()` directly — extract to `src/lib/outbound-callback.ts` once a 2nd consumer materializes.

## Tenant-side verification (for `docs/USER_SETUP.md`)

```js
// tenant's webhook handler
const expected = crypto
  .createHmac('sha256', deliveryCallbackSecret)
  .update(rawBodyBytes) // before any JSON parsing
  .digest('hex');
const actual = req.headers['x-hub-signature']?.replace('sha256=', '');
if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual ?? ''))) {
  return res.status(401).end();
}
```

The tenant MUST verify against raw bytes — not against a re-stringified parsed body — for the same canonical-JSON reason. `docs/USER_SETUP.md` should call this out explicitly when the public docs land.

## When to apply

Any new "Hub POSTs to tenant URL" feature. Always.

## When NOT to apply

Inbound webhooks the Hub receives (e.g., Resend → Hub). Those use the upstream provider's signature scheme (Resend's `resend-signing-secret` / `Webhook-Signature` headers), not this pattern.
