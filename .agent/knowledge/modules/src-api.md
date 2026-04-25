# src/api/

## Purpose

REST endpoints for tenant-facing CRUD (rules, templates, preferences, notifications), admin endpoints (tenant CRUD), event publishing, and health checks.

## Key files

- `src/api/rules.routes.ts` — CRUD for `notification_rules`.
- `src/api/templates.routes.ts` — CRUD for `templates`.
- `src/api/preferences.routes.ts` — CRUD for `user_preferences` (per tenant).
- `src/api/notifications.routes.ts` — List notifications with cursor pagination + status filtering.
- `src/api/admin.routes.ts` — Tenant CRUD under `/api/admin/*`, requires `X-Admin-Key`.
- `src/api/events.routes.ts` — Test event publisher (publishes to Kafka via the shared producer).
- `src/api/health.routes.ts` — `GET /api/health` returns Postgres + Kafka + Resend status (BetterStack polls this).
- `src/api/schemas.ts` — Zod v4 schemas for every route.
- `src/api/middleware/` — `auth.ts` (X-API-Key → tenant), `admin-auth.ts` (X-Admin-Key), `error-handler.ts`, `rate-limiter.ts`.

## Dependencies

- Upstream: `src/db/`, `src/processor/`, `src/consumer/`, `src/lib/`, `src/heartbeat/`.

## Tests

- `src/api/*.test.ts` — every route has happy-path + error + tenant-isolation tests using Fastify `app.inject()`.

## Cross-references

- Pattern: `.agent/knowledge/patterns/003-tenant-auth-injection.md`
- Pattern: `.agent/knowledge/patterns/005-zod-validation.md`
- Pattern: `.agent/knowledge/patterns/006-cursor-pagination.md`
