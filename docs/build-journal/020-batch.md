# Batch 020 — H6 Multiple verified Resend domains per tenant

**Phase:** 7
**Date:** 2026-04-26
**Commit:** 2d24c9e — `feat(channels): multi-domain support per tenant + per-rule override`
**Status:** SUCCESS — 5/5 items + OPS deferred, 3 new tests (352 → 355), TIER_INTEGRATION. **H6 COMPLETE.**

## Items
1. `[DATA]` `notification_rules.from_domain_override TEXT NULL`
2. `[API]` Tenant config `fromDomains: Array<{domain, default}>` with superRefine (exactly one default); rules schema `from_domain_override`
3. `[JOB]` `lib/channel-config.ts` returns `fromDomains` list
4. `[JOB]` `dispatcher.ts` domain priority: rule override → tenant default → first → legacy `from`
5. **Test:** unit — 3 tests covering priority chain + backward compat
6. `[OPS]` ~~Resend dashboard verify klevar.ai DNS~~ deferred — Klevar Docs Path A works on existing notify.klevar.ai per PRD

## Narrative

H6 ships multi-domain support for tenants who need to send from multiple verified domains (e.g., `klevar.ai` for marketing + `notify.klevar.ai` for transactional). Per-rule override lets specific rules pick a non-default domain.

**Domain priority chain:** rule.fromDomainOverride > tenant default-flagged in fromDomains > fromDomains[0] (defensive) > legacy single-domain config.from. Final `From` constructs from local-part of original `config.from` ("Notifications <notify@x.com>" → local-part "notify") combined with chosen domain. Backward compat: tenants without `fromDomains` use legacy verbatim — current behavior unchanged.

OPS step skipped per PRD spec — DNS verification only needed when actually deploying multi-domain. Klevar Docs Path A doesn't need it.

## Design Decisions

- **superRefine: exactly one default** — Zod-level invariant; admin can't accidentally save `[{a, default: true}, {b, default: true}]`.
- **Local-part preservation** — `From` keeps original "notify" / "alerts" / etc, only swaps the domain.
- **Defensive `fromDomains[0]` fallback** — if superRefine somehow misses, dispatcher still picks something rather than throwing.
- **Backward compat verbatim** — tenants without `fromDomains` see no behavior change. Critical for production tenants on legacy config.

## Gotchas Captured

None new.

## New Patterns Established

None new — extends pattern 007 (tenant-channel-config) with per-rule override semantics.

## Bugs Discovered

None new.

## Flags

- `regression_used_no_parallelism` — same digest workaround.
- OPS deferral noted in progress.md with strikethrough.
