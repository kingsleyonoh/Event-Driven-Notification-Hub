# Batch 009 — H2 dispatcher 3-layer reply_to resolution

**Phase:** 7
**Date:** 2026-04-25
**Commit:** e8da4c4 — `feat(channels): 3-layer reply_to resolution in dispatcher`
**Status:** SUCCESS — 4/4 items, 5 new tests (288 → 293), TIER_INTEGRATION. **H2 COMPLETE.**

## Items
1. `[JOB]` `dispatcher.ts` — 3-layer reply_to resolution: event `_reply_to` > template `reply_to` > tenant `config.channels.email.replyTo` > undefined
2. **Test:** unit — 3-layer priority (3 tests)
3. **Test:** unit — all absent → `not.toHaveProperty('replyTo')`
4. **Test:** integration — tenant + event `_reply_to` → Resend gets event-level value

## Narrative

Closes H2. PRD §7.H2 specifies strict priority: event payload `_reply_to` (highest, per-event) > template `reply_to` column (per-doc-type) > tenant `config.channels.email.replyTo` (per-tenant default) > undefined (omit from Resend payload).

Two seams. **(1)** `dispatcher.ts` — extended `DispatchConfig` with optional `templateReplyTo` + `eventReplyTo`; added `resolveReplyTo()` helper walking the priority list. When all three layers absent, helper returns `undefined` AND dispatcher does `delete finalConfig.replyTo` to strip the property — not just leave as `undefined`. Matches pre-existing `email.ts` invariant (only set `sendPayload.replyTo` when truthy). **(2)** `pipeline.ts` — dispatch-config assembly reads `payload._reply_to` (email channel only — never leaks convention to SMS/Telegram/in_app) and `tmpl.replyTo` from the already-fetched template row. Both gated by truthy checks; never land as empty strings.

Reserved-payload-field convention (`_` prefix for control fields like `_reply_to`) is PRD-specified, not silently invented. Confirmed via `grep` against PRD §7.H2 line 817: "if event payload contains `_reply_to` string, that takes priority." Satisfies §8 silent-workaround pre-flight: convention is spec-driven, schema is open (`payload: Record<string, unknown>`).

Test patterns mirrored existing seams: 4 dispatcher unit tests use `vi.mock('./email.js')` seam already in the file, asserting on `sendEmail` args via `expect.objectContaining`. Pipeline integration test cloned `pipeline-attachments.test.ts` shape — `vi.mock('resend')`, `createTestTenant` with `config.channels.email.replyTo`, `processNotification` end-to-end. `expect(sendArgs.replyTo).toBe('event@x.com')` proves highest-priority wins through full pipeline.

## Design Decisions

- **`delete finalConfig.replyTo` when all layers absent** — `not.toHaveProperty('replyTo')` is a stronger assertion than `replyTo: undefined`; matches pre-existing email.ts conditional-spread pattern.
- **Email channel only reads `_reply_to`** — gated in pipeline.ts so SMS/Telegram/in_app don't accidentally inherit the convention.
- **Truthy guards on payload._reply_to and tmpl.replyTo** — prevents empty strings from leaking as valid layers.

## Gotchas Captured

None new.

## New Patterns Established

None — composed pattern 007 (channel-config) + standard priority resolution.

## Bugs Discovered

None new.

## Flags

- `regression_used_no_parallelism` — same digest workaround.
