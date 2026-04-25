# Batch 014 — H5 Sandbox mode per tenant

**Phase:** 7
**Date:** 2026-04-25
**Commit:** f3e42d1 — `feat(channels): sandbox mode per tenant — schema + email + pipeline`
**Status:** SUCCESS — 6/6 items, 3 new tests (319 → 322), TIER_INTEGRATION. **H5 COMPLETE.**

## Items
1. `[DATA]` Migration: `notifications.status` CHECK constraint widened to allow `'sent_sandbox'`
2. `[API]` Tenant config Zod: `sandbox: boolean` on email channel (optional, no default)
3. `[JOB]` `email.ts` sandbox branch — log + skip Resend + return `{success: true, sandbox: true}`
4. `[JOB]` `pipeline.ts` reads `result.sandbox` → status `'sent_sandbox'`
5. **Test:** integration — sandbox=true → no Resend call + status `'sent_sandbox'` (2 tests)
6. **Test:** integration — sandbox flips false → real Resend + status `'sent'` (1 test)

## Narrative

H5 ships the sandbox toggle from PRD §13 Phase 7. Motivation: Klevar Docs' staging needs to exercise the full notification pipeline (rules + templates + dedup + render + dispatch) against real events without dropping mail in customer inboxes.

Core plumbing simpler than expected — email channel already accepts a typed `EmailConfig` from `resolveTenantChannelConfig()`. Adding `sandbox?: boolean` to Zod + `EmailConfig` lets the value flow end-to-end without touching the dispatcher's resolution chain. Short-circuit in `sendEmail`: `if (config.sandbox === true) { log + return; }` — fires BEFORE `new Resend()` constructor; SDK never instantiated for sandboxed tenants. Body excerpt logging capped at 200 chars to keep log volume bounded.

**Status enum widening required a CHECK constraint migration.** Drizzle-kit's `text { enum: [...] }` declaration is TypeScript-only — no Postgres CHECK emitted. This batch is the first to add an explicit `notifications_status_check`. Migration uses `DROP CONSTRAINT IF EXISTS` so it's idempotent. Both DBs verified afterward: accept `sent_sandbox` inserts, reject anything outside the seven enum values. New gotcha 2026-04-25-drizzle-text-enum-no-check-constraint.md.

**Non-obvious regression cascade:** adding `.default(false)` to the Zod schema caused three pre-existing tests to fail because `resolveTenantChannelConfig()` began emitting `{apiKey, from, sandbox: false}` for tenants that had never set the flag — breaking deep-equality assertions locked to the original two-key shape. Switched to `.optional()` (no default), since email branch checks strict `=== true`. Semantics identical (absent = not sandboxed); resolved-config shape stays minimal; downstream tests stable. Trap logged for future channel-config additions.

## Design Decisions

- **`.optional()` not `.default(false)` on Zod sandbox flag** — preserves config-shape stability for deep-equality tests downstream.
- **Body excerpt 200 chars** — bounded log volume; full body never logged.
- **Short-circuit before `new Resend()` constructor** — sandboxed tenants don't even need a Resend API key set.
- **Idempotent CHECK migration with DROP IF EXISTS** — safe to re-apply across both DBs.

## Gotchas Captured

- `2026-04-25-drizzle-text-enum-no-check-constraint.md` — Drizzle's `text { enum: [...] }` is TS-only; emits no Postgres CHECK. Add explicit `ADD CONSTRAINT ... CHECK` migration when DB-level enforcement is needed.

## New Patterns Established

None new.

## Bugs Discovered

None new.

## Flags

- `regression_used_no_parallelism` — same digest workaround.
- `SCHEMA_EXTENDED_IN_BATCH` — status CHECK widened (Option A; PRD-prescribed).
- Trap logged: `.default(false)` on resolver Zod schemas breaks downstream deep-equality.
