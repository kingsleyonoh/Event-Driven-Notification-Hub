# Batch 019 — H9 Multi-language template variants

**Phase:** 7
**Date:** 2026-04-26
**Commit:** 6b0c4d1 — `feat(processor): multi-language template variants (locale + en fallback)`
**Status:** SUCCESS — 5/5 items, 4 new tests (348 → 352), TIER_FULL. **H9 COMPLETE.**

## Items
1. `[DATA]` `templates.locale TEXT NOT NULL DEFAULT 'en'`
2. `[DATA]` Constraint swap: drop `templates_tenant_name_unique`, add `templates_tenant_name_locale_unique`
3. `[API]` Templates Zod accepts `locale`; list endpoint `?locale=de` filter
4. `[JOB]` `pipeline.ts` template lookup with locale → en fallback → fail
5. **Test:** unit + integration — explicit/fallback/missing/end-to-end (4 tests)

## Narrative

H9 ships multi-language template variants. Existing templates auto-default to `'en'` so no migration breakage. New unique constraint `(tenant_id, name, locale)` allows multiple variants per name per tenant.

Pipeline lookup chain: read `event.payload.locale` (default `'en'`) → try `(tenant, name, locale)` → on miss try `(tenant, name, 'en')` → on second miss notification `failed` with clear message `Template "<name>" not found for locale "<locale>" (no en fallback)`.

Factory `createTestTemplate` extended to accept optional `locale` (defaults `'en'`). Existing tests creating templates without locale get the default — no breakage.

## Design Decisions

- **`'en'` fallback hardcoded as the universal default** — PRD-prescribed; aligns with industry convention (English as fallback for transactional email).
- **Constraint swap in single migration** — drop-then-add atomically; existing rows already comply because they have NULL → DEFAULT 'en' transition is safe.
- **List endpoint filter optional** — `?locale=de` filters; absent returns all locales (admin UX needs to see what variants exist).

## Gotchas Captured

None new — Drizzle constraint rename worked cleanly via `drizzle-kit generate`.

## New Patterns Established

None new.

## Bugs Discovered

None new.

## Flags

- `regression_used_no_parallelism` — same digest workaround.
- `e2e_setup_missing: true`.
