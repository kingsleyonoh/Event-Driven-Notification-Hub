# Batch 007 — H1 Email attachments wiring

**Phase:** 7
**Date:** 2026-04-25
**Commit:** 6aeda7d — `feat(processor): wire attachments through pipeline + email dispatch`
**Status:** SUCCESS — 4/4 items, 4 new tests (283 → 287), TIER_INTEGRATION

## Items
1. `[JOB]` `EmailConfig.attachments?: Array<{filename, content}>` forwarded to Resend SDK
2. `[JOB]` `pipeline.ts` calls `fetchAttachments()` after template render; on failure marks notification `failed` and skips dispatch
3. **Test:** integration — happy path: template with `attachments_config` + valid URL → Resend receives attachments
4. **Test:** integration — failure path: URL 500 → notification `failed`, Resend never called

## Narrative

Closes H1. Batch 006 staged the primitives (`fetchAttachments()`, `attachments_config` column, `AttachmentFetchError`); batch 007 wires them: a template with `attachments_config` now produces an email with real PDF bytes attached, and a fetch failure terminates the notification cleanly without a half-sent email.

Three surfaces touched. **(1)** `email.ts` gained an `EmailAttachment` type and an optional `attachments?: EmailAttachment[]` on `EmailConfig`; the Resend `emails.send` payload conditionally includes the `attachments` key only when the array is non-empty (Resend SDK accepts `Attachment[]` with `{filename, content}` base64 — verified against `node_modules/resend/dist/index.d.mts`). **(2)** `dispatcher.ts` gained an optional `attachments` field on `DispatchConfig` and merges it into the resolved `EmailConfig` before calling `sendEmail` — resolver stays clean (credentials only), caller layers in per-notification attachments. **(3)** `pipeline.ts` inserts a step between template rendering and dispatch: when `rule.channel === 'email'` and template has non-empty `attachmentsConfig`, call `fetchAttachments()`, rename `content_base64 → content`, pass through `DispatchConfig.attachments`. On `AttachmentFetchError` (or any throw): `status='failed'` with prefixed `error_message`, early return — dispatch never called.

Test patterns of note: pipeline-attachments tests use `vi.stubGlobal('fetch', ...)` (first project use) since `attachments.ts` calls Node's global `fetch` directly, not through a module boundary that `vi.mock` could intercept. Success test asserts the full chain (fetch URL + AbortSignal, Resend payload shape, notification `sent`). Failure test asserts inverse (Resend never called, notification `failed`, error message contains "attachment"). Together: wiring + early-return guard.

Dispatcher stub-mode path unchanged — if attachments are provided but no Resend credentials, stub-log fires and returns `{success: true}`. Not reachable in production (tenants without Resend keys can't have email rules) but kept consistent.

## Design Decisions

- **Conditional `attachments` key on Resend payload** — only set when array is non-empty. Avoids passing `attachments: undefined` which the SDK might serialize differently.
- **Rename `content_base64` → `content` at pipeline layer** — keeps `attachments.ts` semantically explicit (it returns base64), keeps Resend SDK contract direct (`content` is its field name).
- **Failure marks notification `failed`, not `skipped`** — the `failed` status is for "we tried and couldn't deliver." Attachment fetch failure means the email was undeliverable. `skipped` is for opt-outs / dedup / quiet hours.
- **Used `vi.stubGlobal('fetch', ...)` for pipeline tests** — global `fetch` inside `attachments.ts` doesn't pass through a module boundary that `vi.mock` could intercept.

## Gotchas Captured

None — happy path; Resend SDK shape matched expectations from batch 006 design.

## New Patterns Established

None — used pattern 008 (typed-error-detail) from batch 006.

## Bugs Discovered

None new. Pre-existing digest file-parallelism flake from batch 006 still present; regression run with `--no-file-parallelism` per master direction.

## Flags

- `regression_used_no_parallelism` — required to dodge the pre-existing digest test flake. Filed for follow-up.
