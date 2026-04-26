# Batch 012 — H4 part 2 (webhook ingress + email metadata + admin)

**Phase:** 7
**Date:** 2026-04-25
**Commit:** 2e0eefa — `feat(api): Resend webhook route + Svix sig verify + delivery_callback_secret on admin`
**Status:** SUCCESS — 5/5 items + schema extension, 7 new tests (309 → 316), TIER_FULL

## Items
1. `[API]` `POST /api/webhooks/resend` — public, Svix-signature verified, raw-body parsed, INSERT `email_delivery_events`, UPDATE `notifications`, fire-and-forget callback dispatch
2. `[JOB]` `verifyResendSignature()` — Svix HMAC-SHA256, 60 lines pure `node:crypto`
3. `[JOB]` `email.ts` passes `X-Hub-Notification-ID` + `X-Hub-Tenant-ID` custom headers (Resend echoes back via `data.headers`)
4. `[API]` Admin tenant-create mints + returns `delivery_callback_secret` one-time
5. **Test:** unit — verify (3) + webhook integration (3) + admin secret visibility (1)
6. **Schema extension (Option A):** `notifications.bounce_type TEXT NULL`

## Narrative

H4 part 2 — three pieces: public webhook ingress, email-side metadata round-trip, admin-side secret minting.

**Signature verify is the cryptographic gate** — pure function, 3 tests, no mocking. Implemented Svix's scheme directly in 60 lines of `node:crypto` rather than adding the `svix` package: one less dep, no async wrapping, canonical scheme is a public spec.

**Webhook route was the riskier piece.** Fastify's default JSON parser discards raw body — Svix signatures verify against exact bytes. Fix: scoped `addContentTypeParser` for `application/json` with `parseAs: 'string'`, parse manually, attach `__rawBody` as non-enumerable property. Handler verifies against same bytes Svix saw. Contained to `webhooks.routes.ts` because `addContentTypeParser` inside an `fp` plugin is encapsulated to that scope — doesn't leak to other JSON-POST routes (admin, events).

**Metadata round-trip uses Resend's custom-header passthrough,** not the `tags` API. Custom headers `X-Hub-Notification-ID` + `X-Hub-Tenant-ID` ride along with email send; Resend echoes them in webhook `data.headers`. Webhook handler reads them to correlate back to the originating notification WITHOUT looking up by `resend_email_id` (which arrives later than send time — would create out-of-order race). Tenant-scoped from ingress; no cross-tenant leakage even if `notification_id` is corrupted in transit.

**Integration test impact:** adding `X-Hub-*` to every email send broke a handful of pre-existing tests asserting exact-match `headers`. Three in `pipeline-headers.test.ts`, seven in `dispatcher.test.ts`, one in `consumer/integration.test.ts`. Fix: `toEqual` → `toMatchObject` + explicit positive assertions on `X-Hub-Notification-ID` / `X-Hub-Tenant-ID`. Tests got STRONGER — now verify the new contract (correlation headers always present) AND the old contract (template headers preserved).

**Admin route extension:** `delivery_callback_secret` minted as 32 random hex bytes at tenant create, returned in create response (one-time), stripped from all subsequent GETs by sanitizer. No rotation endpoint yet (future task). Test asserts both create-time visibility and GET-time invisibility.

REGRESSION 309 → 316 in 45s, all green. TypeScript clean.

## Design Decisions

- **Direct Svix HMAC implementation, not the `svix` package** — 60 LOC, one less dep, public spec, no async wrapping.
- **Raw-body capture via scoped `addContentTypeParser`** — encapsulated to webhooks plugin; doesn't leak to other JSON routes.
- **Custom headers `X-Hub-*` for round-trip metadata** — vs Resend's `tags` API. Headers are forwarded by Resend in webhook payload's `data.headers` — solves out-of-order race between send-time and webhook-arrival.
- **`toMatchObject` over `toEqual` in dispatcher/pipeline-headers tests** — strengthens assertions: positively verifies correlation headers without over-constraining other headers.
- **Schema extension `notifications.bounce_type` (Option A)** — PRD H4 specified bounce semantics; column was missing. Added in same migration with notifications.delivered_at gap noted (not added — deferred).

## Gotchas Captured

None new — `addContentTypeParser` raw-body trick may warrant promotion if reused, but currently only one route needs it.

## New Patterns Established

None new — used patterns 008 (typed-error-detail) and 010 (HMAC outbound callback).

## Bugs Discovered

None new.

## Flags

- `regression_used_no_parallelism` — same digest workaround.
- `e2e_setup_missing: true` — endpoint added but no `test:e2e` script. Webhook covered by `app.inject()` integration tests; full E2E TBD.
- `SCHEMA_EXTENDED_IN_BATCH` — `notifications.bounce_type` added (Option A).
