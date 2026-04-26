# Batch 015 — H8 Plain-text email body fallback

**Phase:** 7
**Date:** 2026-04-25
**Commit:** b984c35 — `feat(channels): plain-text email body fallback (body_text)`
**Status:** SUCCESS — 6/6 items, 2 new tests (322 → 324), TIER_INTEGRATION. **H8 COMPLETE.**

## Items
1. `[DATA]` Migration: `templates.body_text TEXT NULL`
2. `[API]` Templates Zod: `body_text` optional/nullable
3. `[JOB]` `EmailConfig.text` forwarded to Resend SDK
4. `[JOB]` `pipeline.ts` renders `body_text` Handlebars; passes through dispatch
5. **Test:** unit — both `html` + `text` passed when set (1 test)
6. **Test:** unit — `text` key absent when not provided (1 test)

## Narrative

H8 wires plain-text alternative body through the email path. Migration is a single nullable TEXT column. Drizzle schema, Zod, templates routes — all mirror the existing `attachments_config`/`reply_to`/`headers` plumbing.

**Render path interesting bit:** `pipeline.ts` runs `renderTemplate(tmpl.bodyText, payload)` only when `rule.channel === 'email'` AND `tmpl.bodyText` is non-empty. Render failures soft-fall to "let Resend auto-generate text from HTML" rather than failing dispatch — same logging pattern (`logger.warn` with eventId/recipient context) that header-render uses. Rendered text conditionally spread into `DispatchConfig.text`, then `EmailConfig.text`, then Resend payload — three layers of "only when set", symmetric with existing attachments/headers/replyTo plumbing.

**Sharper test on omit-when-empty:** added a sub-case `{...config, text: ''}` to verify the explicit empty-string branch is omitted from the Resend payload — locks in the behavior, not just the absence.

## Design Decisions

- **Soft-fall on body_text render failure** (let Resend auto-gen) vs. fail dispatch — text body is an enhancement, not a requirement; HTML body is the primary content.
- **Three-layer conditional spread** symmetric with existing optional fields — keeps reasoning uniform across attachments/headers/replyTo/text.
- **Empty-string branch test** in addition to undefined — locks in actual implementation behavior.

## Gotchas Captured

None new — used existing test-DB-separate-ALTER gotcha.

## New Patterns Established

None new.

## Bugs Discovered

None new.

## Flags

- `regression_used_no_parallelism` — same digest workaround.
