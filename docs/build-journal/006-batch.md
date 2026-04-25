# Batch 006 — H1 Email attachments foundation

**Phase:** 7
**Date:** 2026-04-25
**Commit:** 8bb31f3 — `feat(channels): add fetchAttachments module + attachments_config schema`
**Status:** SUCCESS — 4/4 items, 14 new tests (269 → 283), TIER_INTEGRATION

## Items
1. `[DATA]` Migration: `templates.attachments_config JSONB DEFAULT NULL`
2. `[API]` Zod schema accepts `attachments_config: Array<{filename_template, url_field}>` on template create/update
3. `[JOB]` New module `src/channels/attachments.ts` — `fetchAttachments()` with dot-path resolution, Handlebars filename rendering, fetch+retry, base64, 38MB cap, `AttachmentFetchError`
4. **Test:** 6 unit tests for attachments module + 8 schema tests

## Narrative

Foundation batch for Phase 7 H1. The 9-item PRD task is split deliberately: this batch lays down the data shape, validation surface, and pure-logic fetch module; batch 007 will wire `EmailConfig.attachments`, call `fetchAttachments()` from `pipeline.ts`, and add integration tests with mocked Resend. The split keeps the commit under the 500-line guideline and separates "foundation" from "wiring" cleanly.

The attachments module is ~160 lines. Three concerns: (1) `resolveDotPath()` walks payload segments and bails on null/undefined/non-object; (2) Handlebars filename rendering reuses the existing `renderTemplate()` from `src/templates/renderer.ts` — no new Handlebars wiring; (3) fetch with 30s `AbortController` timeout + 1 retry on network error or 5xx. The 38 MB cap is enforced cumulatively — the loop accumulates `totalBytes` and throws `AttachmentFetchError(reason: 'SIZE_CAP_EXCEEDED')` the moment the running total crosses the threshold. Resend's hard cap is 40 MB inclusive of body, so failing fast mid-loop avoids wasted bytes.

The trickiest design decision was structured error metadata. `AppError.details: string[]` is the wire shape — adding `failed_url`, `reason`, `attempted_retries` as typed fields without breaking that shape required a new pattern (see Pattern 008). Solution: typed instance field on the subclass (`err.attachmentDetails.reason`) plus JSON-stringified entry in `details` for the wire format. Pipeline code in batch 007 will read the typed field directly; clients still see `details: [JSON_STRING]` via `toErrorResponse()`.

A regression near-miss: parallel-mode regression initially showed 3 failures in `src/digest/engine.test.ts`. Looked like new code broke digest queue ordering — but digest doesn't read or write `attachments_config`. Tracing it down: the digest tests reuse `tenant.id` across describe blocks without per-test `digest_queue` cleanup; under file-parallelism, scheduled-for timestamps collide. Pre-existing flake; logged as Bug Discovered. Single-file isolation and `--no-file-parallelism` both clean. Filed for follow-up batch.

## Design Decisions

- **Typed structured-detail field on `AttachmentFetchError`** — preserves wire shape, gives pipeline code typed access. See Pattern 008.
- **Wire Zod field through templates routes in this batch** even though pipeline doesn't consume it yet — "Wire It or Delete It"; route silently dropping a Zod field is dead-code-as-contract.
- **Cumulative 38 MB cap, not per-attachment** — matches Resend's whole-message constraint; fails fast.
- **`AbortController` for 30s timeout, not `Promise.race`** — actually cancels the socket; standard Node 22 fetch idiom.

## Gotchas Captured

- `2026-04-25-test-db-needs-separate-alter.md` — Test DB (`notification_hub_test`) needs separate ALTERs from dev DB when bypassing `drizzle-kit migrate` (Windows hang gotcha).

## New Patterns Established

- `008-typed-error-detail.md` — AppError subclasses can carry typed structured metadata via a `<domainDetails>` instance field while keeping the `details: [json_string]` wire shape.

## Bugs Discovered

- `src/digest/engine.test.ts` flakes under file-parallelism — shared tenant + missing `digest_queue` cleanup between tests. Pre-existing. Estimated fix: 1-file (`afterEach` cleanup or fresh tenant per test).

## Flags

- `no_test_tier_split` — project has only `npx vitest run`; no unit/integration split exists. Suggest splitting in `/sync-context`.
- Drizzle snapshot artifact in commit (857 lines auto-generated) — expected.
