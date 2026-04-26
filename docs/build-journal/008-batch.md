# Batch 008 — H2 reply_to schema + email plumbing

**Phase:** 7
**Date:** 2026-04-25
**Commit:** 7af04fa — `feat(channels): add reply_to support — schema + email plumbing`
**Status:** SUCCESS — 5/5 items, 1 new test (287 → 288), TIER_INTEGRATION

## Items
1. `[DATA]` Migration: `templates.reply_to TEXT NULL`
2. `[API]` Tenant config Zod: `replyTo` on email channel
3. `[API]` Templates Zod: `reply_to` on create/update
4. `[JOB]` `EmailConfig.replyTo` forwarded to Resend SDK
5. **Test:** `email.test.ts` — `replyTo` set vs absent

## Narrative

H2 part 1. Schema, Zod, email-channel surfaces. Dispatcher 3-layer resolution (event > template > tenant) deferred to batch 009 per assignment scope.

Mechanical work — followed the same shape as batch 006's `attachments_config` plumbing: extend Drizzle schema → `drizzle-kit generate` → ALTER both `notification_hub` AND `notification_hub_test` (Windows `drizzle-kit migrate` hang gotcha) → extend Zod → wire through templates routes → forward through `EmailConfig` to Resend.

Resend SDK gotcha worth noting: the SDK accepts both `reply_to` (snake) and `replyTo` (camel) on different interface variants. The `SendEmailOptions` interface (used by `resend.emails.send()` in this project) declares `replyTo?: string | string[]` at line 305 of `node_modules/resend/dist/index.d.mts`. `EmailApiOptions` uses snake_case but is a different path. Chose camelCase to match the existing payload-object key style. PRD's "reply_to field" refers to the feature, not the wire format.

Test pattern: single test confirms both branches — when `EmailConfig.replyTo` is set, it appears in the Resend call payload; when absent, the call payload has no `replyTo` key (`expect(callArgs).not.toHaveProperty('replyTo')`). Guards against accidentally always passing `undefined`, which Resend treats differently from key omission.

## Design Decisions

- **Resend SDK field name `replyTo` (camelCase)** — matches `SendEmailOptions` typing the project uses; aligns with existing payload-object style.
- **`replyTo` omitted entirely when undefined** — Resend treats `replyTo: undefined` differently from key omission. Conditional spread used.
- **Single test for both branches** — assertion shape `not.toHaveProperty('replyTo')` is just as strong as a separate test; keeps test count surgical.

## Gotchas Captured

None new. Used existing gotchas: `2026-04-25-test-db-needs-separate-alter.md` (applied ALTER to both DBs).

## New Patterns Established

None.

## Bugs Discovered

None new. Pre-existing digest file-parallelism flake — regression with `--no-file-parallelism`.

## Flags

- `regression_used_no_parallelism` — same workaround as batches 006/007. Filed for follow-up.
- `SCHEMA_EXTENDED_IN_BATCH` — Zod schemas widened (tenant config + templates); tracked in deviations log.
