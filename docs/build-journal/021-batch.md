# Batch 021 — Phase 7 7b bonus + ship-gate verification

**Phase:** 7
**Date:** 2026-04-26
**Commit:** d3afad2 — `feat(api): Phase 7 7b bonus features + ship-gate verification`
**Status:** SUCCESS — 4 of 6 7b items + ship-gate verification, 23 new tests (355 → 378), TIER_FULL.

## Items
1. `[DATA]` `notifications.metadata JSONB DEFAULT NULL` + pipeline copies `event.payload._metadata`
2. `[API]` Recipient validation Zod superRefine — email/sms/telegram shape on `recipient_type='static'`
3. `[API]` Tenant config schema validation applied on tenant create + admin patches
4. `[API]` `/api/health/detailed` extended with `email_delivery_events_24h_count`
5. `[DOCS]` `docs/USER_SETUP.md` — Phase 7 features overview section
6. `[SHIP-GATE]` Ticked items 1-3 (tests passing 378/378, coverage verified, USER_SETUP docs); items 4-6 left unchecked (production deploy needs user authorization)

## Narrative

Final autonomous batch. Ships 4 of 6 7b bonus items + USER_SETUP overview + ship-gate verification.

**Skipped intentionally:** HMAC-SHA256 for ALL outbound (Pattern 010 already covers it; no other outbound callbacks exist yet — verify-on-add). __digest improvements (lower-priority polish — Phase 7.5).

**`notifications.metadata` reserved-underscore convention** matches `_reply_to` from H2 — pipeline copies `event.payload._metadata` (if present) verbatim. Cross-system request_id propagation pattern.

**Recipient validation Zod superRefine** is conditional on `recipient_type='static'` — payload-path recipients can't be validated at create-time (the value is a path, not the actual recipient). Email regex / phone regex / telegram chat_id regex applied per channel.

**Tenant config schema validation applied at WRITE time.** Previously `tenants.config` was freeform JSONB — admin POST/PATCH could persist anything; misconfiguration only surfaced at dispatch time when a Resend key was missing or malformed. Now Zod composes all Phase 7 fields (replyTo, deliveryCallbackUrl, sandbox, fromDomains, rate_limits) into a single tenant-config schema applied on every admin write. Returns 422 with details on malformed config.

**Health-check axis:** `email_delivery_events_24h_count` is a proxy for "is H4 callback flow healthy?" — low count = either healthy production traffic OR Resend webhook misconfigured; admin uses this signal.

**Ship-gate ticks:** items 1-3 verified by this batch (tests 378/378 green; coverage maintained — flagged branches discrepancy in flags but still meets ≥80% statements/lines threshold; USER_SETUP docs done). Items 4-6 (GHCR rebuild, VPS redeploy, Klevar Docs notification) require user authorization — left unchecked.

## Design Decisions

- **Reserved underscore convention** (`_metadata`, `_reply_to`) — consistent across PRD-prescribed control fields in event payloads.
- **Recipient validation only on `recipient_type='static'`** — payload-path recipients deferred to dispatch time naturally.
- **Tenant config validated on WRITE, not READ** — fail fast at admin time, not at the dispatch hot path.
- **Health endpoint stays public** — count is global, no per-tenant scoping. Admin can see total system throughput.

## Gotchas Captured

None new.

## New Patterns Established

None new (Pattern 010 HMAC outbound covers the 7b "HMAC for ALL" item by reuse).

## Bugs Discovered

None new.

## Flags

- `regression_used_no_parallelism` — same digest workaround.
- `e2e_setup_missing: true`.
- Coverage branch % flagged but statements/lines well above 80%.
- 2 of 6 7b items deferred to Phase 7.5: HMAC-for-ALL-outbound (already covered) + __digest improvements (polish).

## Phase 7 Final Status

✅ ALL H1-H10 features (CRITICAL/HIGH/MEDIUM/LOW)
✅ 4 of 6 7b bonus features
✅ Ship-gate items 1-3 (tests, coverage, USER_SETUP docs)
⏳ Ship-gate items 4-6 — production deploy steps (user authorization required):
   - `docker-compose.prod.yml` rebuild + push to GHCR
   - VPS redeploy + smoke test
   - Notify Klevar Docs to start retrofit
