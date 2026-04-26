# Batch 017 — H10 part 1 (suppression list foundation)

**Phase:** 7
**Date:** 2026-04-25
**Commit:** e7d9f62 — `feat(processor): suppression list — pipeline guard + auto-add on hard bounces`
**Status:** SUCCESS — 5/5 items, 3 new tests (336 → 339), TIER_FULL.

## Items
1. `[DATA]` `tenant_suppressions` table — `(tenant_id FK CASCADE, recipient, reason, expires_at, UNIQUE(tenant_id, recipient))`
2. `[JOB]` `pipeline.ts` pre-dispatch suppression check — case-insensitive, expires_at-aware, in_app-exempt
3. `[API]` `webhooks.routes.ts` auto-INSERTs on `email.bounced` (hard) + `email.complained`, `ON CONFLICT DO NOTHING`
4. **Test:** unit — pipeline guard (suppressed → skipped; different recipient → not blocked)
5. **Test:** integration — Resend hard-bounce webhook → suppression inserted → next event skipped

## Narrative

H10 foundation. Adds tenant-scoped suppression list with two write paths: automatic (Resend hard-bounce / complaint webhook) and manual (admin route — deferred to batch 018). Read path is the pipeline pre-dispatch guard.

Pipeline guard at step 3.5 (after dedup, before dispatch): case-insensitive recipient match, NULL `expires_at` = permanent, future `expires_at` = active. In_app channel exempt because it uses `userId` not an email/phone — suppression is recipient-based.

Webhook auto-add ties into batch 012's webhook handler. Hard bounce detection uses Resend's `data.bounce.type === 'hard'` (or fallback to event type === `email.bounced` since Resend distinguishes bounce types in the payload). Complaint always goes to suppression. Idempotent via `ON CONFLICT (tenant_id, recipient) DO NOTHING` — same recipient bouncing twice doesn't error.

3 new tests on top of 12 existing pipeline tests. Cross-tenant fixture used: tenant A's suppression of `x@y.com` does not affect tenant B's send to `x@y.com` (verified in unit test).

## Design Decisions

- **Case-insensitive recipient match** — `LOWER(recipient) = LOWER($input)` per query; recipients stored as-given but compared lower. Avoids "User@x.com" vs "user@x.com" sneaking past.
- **In_app channel exempt** — `userId` semantics differ; suppression is recipient-based.
- **`ON CONFLICT DO NOTHING`** — idempotent webhook handling; duplicate bounces don't error.
- **`expires_at NULL = permanent`** — explicit semantics; default for hard bounces / complaints.

## Gotchas Captured

None new — Resend bounce-type detection used existing payload field; no surprises.

## New Patterns Established

None new.

## Bugs Discovered

None new.

## Flags

- `regression_used_no_parallelism` — same digest workaround.
- H10 part 2 (admin CRUD routes + manual block/unblock integration tests) deferred to batch 018.
