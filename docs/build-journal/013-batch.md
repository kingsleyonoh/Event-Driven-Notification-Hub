# Batch 013 — H4 part 3 (integration tests + docs) — H4 COMPLETE

**Phase:** 7
**Date:** 2026-04-25
**Commit:** 001833f — `feat(api): H4 webhook integration tests + USER_SETUP docs — H4 COMPLETE`
**Status:** SUCCESS — 3/3 items, 3 new tests (316 → 319), TIER_FULL. **H4 COMPLETE — ship-gate CRITICAL/HIGH set DONE.**

## Items
1. **Test:** integration — POST mock Resend webhook → DB updated → mock callback URL receives signed POST
2. **Test:** integration — callback URL 500 → `callback_status_code=500`, webhook still 200s (no infinite retry)
3. `[DOCS]` `docs/USER_SETUP.md` Section 10: Resend webhook config + per-tenant callback opt-in + Node/Python verification snippets

## Narrative

H4 closes. Implementation already shipped in batches 011-012; this batch adds end-to-end coverage of the full chain — Svix-signed inbound → DB writes → fire-and-forget HMAC-signed outbound — plus tenant-side docs.

**Tricky bit:** route uses `void dispatchDeliveryCallback(...).catch(...)` (fire-and-forget) — naive `app.inject().then(assert)` race-conditions with dispatch. Three options considered: (1) test-only hook returning the in-flight promise, (2) `setImmediate()` + polling, (3) keep production fire-and-forget + use `waitFor` polling helper in test. **Chose 3** — production behavior (truly non-blocking) is the contract; adding a side-channel for tests would introduce code production doesn't need. Polling helper waits up to 2s for `mockFetch.mock.calls.length >= 1` then re-polls for `callback_status_code` in Postgres. Fast in green (~10-50ms typical), bounded in red.

**RED-phase honesty in backfill scenario:** since implementation already existed, temporarily disabled the dispatch line in the route and confirmed exactly the two flow tests fail (with expected `waitFor` timeout) while the tenant-isolation test stays green (doesn't depend on dispatch). This proves the new tests genuinely catch the dispatch contract, not incidentally pass against existing code.

**USER_SETUP.md Section 10** covers Hub-side webhook config, per-tenant callback opt-in, and tenant-side verification snippets in Node + Python. Snippets deliberately show reading raw bytes (`express.raw`, `request.get_data()`) not parsed JSON — Hub's HMAC computes over canonical-JSON bytes; any upstream JSON middleware re-stringification would break the signature. Load-bearing detail.

## Design Decisions

- **Polling `waitFor` over test-only async hook** — preserves production fire-and-forget contract; no test side-channel.
- **RED via temporary dispatch-line disable** — honest backfill evidence; tests fail without the contract.
- **Tenant isolation test included** — second tenant's webhook does not write to first tenant's `email_delivery_events`.
- **Verification snippets emphasize raw bytes** — prevents the most common tenant integration bug (re-stringified JSON breaks HMAC).

## Gotchas Captured

None new — `waitFor` polling pattern noted but is a single-test idiom, not yet a project-wide pattern.

## New Patterns Established

None new — used existing pattern 010 (HMAC outbound callback).

## Bugs Discovered

None new.

## Flags

- `regression_used_no_parallelism` — same digest workaround.
- `e2e_setup_missing: true` — webhook covered by `app.inject()`; full E2E TBD when `test:e2e` script lands.

## Phase 7 Ship-Gate Status

✅ H1 — Email attachments (CRITICAL) — batches 006-007
✅ H2 — reply_to per tenant/template/event (HIGH) — batches 008-009
✅ H3 — Custom email headers / RFC 8058 List-Unsubscribe (HIGH) — batch 010
✅ H4 — Resend webhook + tenant delivery callback (HIGH) — batches 011-013

**Klevar Docs cutover unblocked.**

Tests: 269 → 319 (+50 across 8 batches).
Patterns added: 2 (008-typed-error-detail, 010-hmac-signed-outbound-callback) + 1 (009-soft-fail-per-key-handlebars-render).
Gotchas added: 1 (2026-04-25-test-db-needs-separate-alter).
