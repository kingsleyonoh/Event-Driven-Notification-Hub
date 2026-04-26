# Batch 010 — H3 Custom email headers (RFC 8058)

**Phase:** 7
**Date:** 2026-04-25
**Commit:** ebdcc11 — `feat(channels): custom email headers with Handlebars rendering`
**Status:** SUCCESS — 6/6 items, 13 new tests (293 → 307), TIER_INTEGRATION. **H3 COMPLETE.**

## Items
1. `[DATA]` Migration: `templates.headers JSONB DEFAULT NULL`
2. `[API]` Templates Zod: `headers` JSONB; RFC-822 regex + reserved-name superRefine
3. `[JOB]` `EmailConfig.headers` → Resend SDK
4. `[JOB]` `pipeline.ts` per-key Handlebars render + soft-fail
5. **Test:** unit — header render (1) + schema rejection (9 tests covering forbidden + malformed + happy)
6. **Test:** integration — `List-Unsubscribe` + `List-Unsubscribe-Post` end-to-end (3 tests)

## Narrative

Closes H3 — third of four CRITICAL/HIGH features for Klevar Docs cutover gate. RFC 8058 List-Unsubscribe + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` is required by Gmail for high-volume senders to avoid spam classification. Without it, marketing email from Hub tenants silently degrades into Promotions/Spam.

Implementation chain: `templates.headers` JSONB column → Zod with reserved-name + RFC-822 regex → `templates.routes.ts` plumbs on insert/update → `pipeline.ts` renders each header value via Handlebars per-event → `dispatcher.ts` forwards as `DispatchConfig.headers` → `email.ts` adds to Resend `sendPayload.headers`. All five surfaces wired in one batch.

Soft-fail loop in pipeline.ts is the interesting design decision (now Pattern 009). Handlebars uses non-strict mode, but `{{> nonexistent_partial}}` and similar partial/helper references throw at render time. PRD authorized soft-fail: skip failing header, log warn with `{headerName, error}`, continue. Structurally different from attachments (any fetch fail = notification `failed`) — for headers, the email is still useful with one optional header omitted. Implemented as `for...of Object.entries()` with per-entry try/catch, accumulating into a fresh map, attaching `renderedHeaders` to dispatch config only when non-empty.

Zod design uses `superRefine` for case-insensitive reserved-name guard (`Content-Type`, `From`, `To`, `Subject`). RFC-822 token regex at the key level via `z.record(z.string().regex(/^[A-Za-z0-9-]+$/), z.string().min(1))`. Both layers fire: malformed names get generic Zod regex error; reserved names get user-friendly `"Header name 'From' is reserved by Resend; cannot override"`.

Three mechanics already paved by 008/009: `--no-file-parallelism` workaround, dual-DB ALTER pattern, mock-Resend test pattern. No new gotchas surfaced.

## Design Decisions

- **Per-key soft-fail (Pattern 009)** — vs. all-or-nothing (one bad header skips email). PRD-authorized; useful headers still get sent.
- **Two-layer Zod validation** — regex at key + superRefine reserved-name list. Precise error messages per failure class.
- **Conditional `headers` on Resend payload** — only set when non-empty map; consistent with `attachments` and `replyTo` patterns.
- **Render at pipeline (not dispatcher)** — keeps dispatcher pure (no Handlebars dep) and renderer in the layer that already has payload context.

## Gotchas Captured

None new.

## New Patterns Established

- `009-soft-fail-per-key-handlebars-render.md` — Per-key soft-fail when rendering a `{key: handlebarsTemplate}` JSONB map. Skip + warn on per-entry throw, ship the rest. Used for email headers (RFC 8058).

## Bugs Discovered

None new.

## Flags

- `regression_used_no_parallelism` — same digest workaround as 006-009.
