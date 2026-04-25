# Batch 016 — H7 Per-tenant rate limit on `/api/events`

**Phase:** 7
**Date:** 2026-04-25
**Commit:** 03e5a23 — `feat(api): per-tenant rate limit on /api/events + admin patch route`
**Status:** SUCCESS — 5/5 items, 10 new tests (324 → 336), TIER_FULL. **H7 COMPLETE.**

## Items
1. `[API]` `events.routes.ts` swaps static `max: 10` for `(req) => resolveTenantEventsRateLimit(req.tenant)` + per-tenant `keyGenerator`
2. `[JOB]` `resolveTenantEventsRateLimit()` helper — reads `tenant.config.rate_limits.events_per_minute`, default 200, cap at 1000
3. `[API]` `PATCH /api/admin/tenants/:id/rate-limit` — body `{events_per_minute}`, validates 1-1000, spread-merges into `tenants.config`
4. **Test:** unit — resolver tests (5: 10/100/no-override/null-config/cap-at-1000)
5. **Test:** integration — tenant A 10/min blocks 11th; tenant B 100/min doesn't (5 admin happy/range-edge/404/preservation)

## Narrative

Phase 7 H7 ships per-tenant configurable rate limiting on `POST /api/events`. Before this batch: hardcoded `{rateLimit: {max: 10, timeWindow: '1 minute'}}` global cap — (a) blocked legit high-volume tenants, (b) IP-based bucket so two tenants behind same NAT shared the limit. Klevar Docs needed configurable per-tenant cap before cutover.

Three load-bearing pieces: **(1)** `resolveTenantEventsRateLimit(tenant)` reads `tenant.config.rate_limits.events_per_minute` (default 200, cap 1000). **(2)** `events.routes.ts` swaps static `max: 10` for `(req) => resolveTenantEventsRateLimit(req.tenant)` + `keyGenerator: (req) => req.tenantId` — this is the multi-tenant fix; without per-tenant keys, tenant A's burst consumes tenant B's bucket. **(3)** Admin `PATCH` updates `tenants.config.rate_limits.events_per_minute` via spread-merge preserving channel credentials, dedup_window, etc.

**Non-obvious gotcha — hook ordering.** `@fastify/rate-limit` defaults to `onRequest`, but `authPlugin` ALSO uses `onRequest` to populate `request.tenant`. Fastify fires hooks in registration order, so by default rate-limit's `max` callback would receive a request without `request.tenant` — resolver would always return default 200, defeating the per-tenant feature. Setting `hook: 'preHandler'` on the route's `config.rateLimit` moves the rate check to AFTER auth. Per-route override; global plugin still defaults to `onRequest`. Surgical impact.

Test coverage went beyond the 3+2 spec: resolver got 5 tests (null-config branch + cap-at-1000); admin got 5 (range validation top+bottom, 404, config-preservation verifying channels/dedup_window survive the patch). Regression clean at 336.

## Design Decisions

- **`hook: 'preHandler'` on the rate-limit route config** — fixes ordering vs `authPlugin.onRequest`. Surgical per-route override.
- **`keyGenerator: req.tenantId`** — fixes per-IP→per-tenant scoping; mandatory for multi-tenant correctness.
- **Spread-merge in admin PATCH** — preserves rest of `tenants.config` (channels, dedup_window). Avoids overwriting bug.
- **Cap at 1000 in resolver** — defensive; prevents misconfigured tenant from DoS-ing the platform.

## Gotchas Captured

None new — though hook-ordering gotcha may warrant promotion if it bites again. Not yet a separate file.

## New Patterns Established

None new — extends existing pattern 004 (per-route rate limit) with dynamic `max` resolution.

## Bugs Discovered

None new.

## Flags

- `regression_used_no_parallelism` — same digest workaround.
- `e2e_setup_missing: true` — admin endpoint added; covered by `app.inject()`.
