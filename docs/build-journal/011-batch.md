# Batch 011 — H4 part 1 (foundation: schema + signing module)

**Phase:** 7
**Date:** 2026-04-25
**Commit:** c152c85 — `feat(channels): delivery callback module + email_delivery_events schema`
**Status:** SUCCESS — 5/5 items, 2 new tests (307 → 309), TIER_INTEGRATION

## Items
1. `[DATA]` Migration: `email_delivery_events` table (FK CASCADE on tenant, SET NULL on notification)
2. `[DATA]` Migration: `tenants.delivery_callback_secret TEXT NULL`
3. `[JOB]` `src/channels/delivery-callback.ts` — `dispatchDeliveryCallback()` + pure `signPayload()` helper
4. `[API]` Tenant config Zod: `deliveryCallbackUrl` URL validation on email channel
5. **Test:** unit — HMAC signing determinism (2 tests)

## Narrative

H4 is the largest H feature. Splitting into 3 batches: (011) foundation — schema + signing module; (012) webhook route + signature verification + email.ts metadata + admin route extension; (013) integration tests + Resend webhook docs. Keeps each batch under 1000 LOC and surface-focused.

**Cross-cutting design decision:** factored `signPayload(event, secret): string` as a pure exported helper rather than burying inside `dispatchDeliveryCallback`. Two purposes: (1) HMAC determinism tests have nothing to mock — pass fixed inputs, assert on digest. (2) Future callback families (H10 suppression callbacks, generic 7b webhooks) reuse the primitive without importing a private function. PRD §7b extends HMAC signing to ALL outbound callbacks — documented as Pattern 010 to make the recipe canon.

**`canonicalJson()` is the load-bearing correctness piece.** Naïve `JSON.stringify` produces different bytes for `{a:1,b:2}` vs `{b:2,a:1}` — a tenant reconstructing the body from parsed JSON would get a different HMAC than what we computed. Recursive sort + manual JSON build solves this. Deliberately doesn't handle Date/Map/Set/BigInt because Resend webhook payloads are pure JSON — keeping it simple keeps it auditable.

Migration ran cleanly into both DBs after `docker exec psql` per the test-DB-separate-ALTER gotcha. REGRESSION 307 → 309 in 40s, no new failures, all green. TypeScript clean first try.

## Design Decisions

- **`signPayload()` exported as pure helper** — testable without HTTP mock; reusable for H10/7b future callbacks.
- **`canonicalJson()` for deterministic signing** — recursive key sort + manual build. Tenants verifying signatures must replicate this exact byte stream.
- **Function never blocks on callback failure** — `dispatchDeliveryCallback` returns void either way; failure logged + status code recorded but caller continues.
- **`callback_status_code: NULL` on network error, integer on response** — distinguishes "couldn't reach tenant" from "tenant returned 5xx."

## Gotchas Captured

None new (used existing test-DB-separate-ALTER gotcha).

## New Patterns Established

- `010-hmac-signed-outbound-callback.md` — HMAC-SHA256 signing recipe for ALL Hub→tenant outbound callbacks: per-tenant secret, canonical JSON, `X-Hub-Signature: sha256=<hex>`, 5s timeout, never-blocks. Will be reused for H10 suppression callbacks and 7b generic webhooks.

## Bugs Discovered

None new.

## Flags

- `regression_used_no_parallelism` — same digest workaround.
