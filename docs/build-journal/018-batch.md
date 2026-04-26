# Batch 018 — H10 part 2 (suppressions CRUD)

**Phase:** 7
**Date:** 2026-04-26
**Commit:** f61b2d4 — `feat(api): suppressions CRUD routes — H10 COMPLETE`
**Status:** SUCCESS — 5/5 items, 9 new tests (339 → 348), TIER_FULL. **H10 COMPLETE.**

## Items
1. `[API]` `src/api/suppressions.routes.ts` mounted at `/api/suppressions` under tenant auth
2. `[API]` `POST /api/suppressions` — idempotent (ON CONFLICT DO NOTHING returns existing with 200; new with 201)
3. `[API]` `DELETE /api/suppressions/:id` — tenant-scoped 404 if other tenant's row
4. `[API]` `GET /api/suppressions` — cursor pagination (with microsecond-precision fix)
5. **Test:** integration — manual block + unblock + cross-tenant isolation + 404 + GET pagination (9 tests)

## Narrative

Closes H10. User-facing suppression CRUD surface complements the auto-suppression wired in batch 017 (webhook hard-bounce → `tenant_suppressions` + pipeline guard). Three routes: POST (manual, default `reason='manual'`), DELETE (cross-tenant 404), GET (cursor-paginated). POST is intentionally idempotent — `ON CONFLICT (tenant_id, recipient) DO NOTHING` returns existing row with 200 rather than 201; matches admin retry semantics.

**Interesting finding: cursor pagination microsecond bug.** Test seeds 5 suppressions in a single Drizzle batch insert; Postgres assigns them all the same transaction timestamp at microsecond precision. With cursor encoding via `Date.toISOString()` (millisecond precision) but PG storing microsecond, the tuple comparison `(stored_ts, stored_id) < (cursor_ts, cursor_id)::timestamp` missed rows because `stored_ts > cursor_ts` at microsecond level even when reading identical at millisecond level.

First fix attempt with OR-form (`lt(ts) OR (eq(ts) AND lt(id))`) didn't help — `eq(ts)` on column-vs-millisecond-cast also missed.

**Final fix:** encode `to_char(... AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')` as a side-channel column on the SELECT, use that text value verbatim in the cursor, cast back as `::timestamp` on decode. Trim off helper column before response.

Notifications route (the existing cursor reference) doesn't hit this because in production each notification is inserted in its own transaction → practically unique timestamps. Suppressions are realistic to bulk-insert (admin importing a bounce list) so this matters.

**Multi-tenant isolation strictly enforced:** tenantA and tenantB created in `beforeAll`. Cross-tenant DELETE test seeds tenantB via DB direct, asserts tenantA's API can't 200 on it (404 + row still present). GET test seeds both, asserts tenantA only sees own rows.

## Design Decisions

- **Idempotent POST (ON CONFLICT → 200 with existing)** — matches admin retry semantics; avoids surprising 409s on duplicate submission.
- **Microsecond-precision cursor** — `to_char()` with `'YYYY-MM-DD"T"HH24:MI:SS.US'` for byte-exact round-trip; protects against bulk-insert collision.
- **Tenant-scoped DELETE → 404 cross-tenant** — never a 403; doesn't leak existence.
- **GET sorts `created_at DESC, id DESC`** — newest first; matches notifications/templates pattern.

## Gotchas Captured

- (worth promoting to a gotcha file in a future batch — for now noted in result file): `Date.toISOString()` cursor encoding loses microsecond precision vs PG's TIMESTAMP storage; bulk-insert seeds expose the lossy round-trip. Fix: `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US')`.

## New Patterns Established

Pattern 006 cursor-pagination extended in-place with the microsecond-precision recipe (note in pattern file as `006-PLUS` micro-pattern, not a new file).

## Bugs Discovered

None new — the cursor microsecond issue was discovered AND fixed in this batch, so it never landed.

## Flags

- `regression_used_no_parallelism` — same digest workaround.
- `e2e_setup_missing: true` — admin endpoints; covered by `app.inject()`.
