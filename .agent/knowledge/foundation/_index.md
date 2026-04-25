# Shared Foundation — Index

> **One file per foundation primitive.** This index is a human-readable catalog, rewritten by the AI whenever a sibling file is added, renamed, or removed. Never append to a single growing table — write a new sibling instead. See `.agent/rules/CODING_STANDARDS.md` — "Append-Only Knowledge Files Banned."

## Catalog

| File | Summary |
|------|---------|
| `db-client.md` | Drizzle ORM client (`src/db/client.ts` — `createDb(url)` returns `{ db, sql }`). |
| `db-schema.md` | All Drizzle table defs, types, relations (`src/db/schema.ts`). |
| `core-config.md` | Env var loader + validator (`src/config.ts`). |
| `core-server.md` | Fastify app bootstrap + plugin registration order (`src/server.ts`). |
| `lib-errors.md` | `AppError` hierarchy + `toErrorResponse()` (`src/lib/errors.ts`). |
| `auth-tenant-middleware.md` | X-API-Key → tenant lookup; injects `request.tenantId` (`src/api/middleware/auth.ts`). |
| `auth-admin-middleware.md` | X-Admin-Key validation for `/api/admin/*` (`src/api/middleware/admin-auth.ts`). |
| `api-error-handler.md` | Global Fastify error handler → `{ error: { code, message, details } }` (`src/api/middleware/error-handler.ts`). |
| `api-rate-limiter.md` | `@fastify/rate-limit` `global: false`; per-route opt-in (`src/api/middleware/rate-limiter.ts`). |
| `api-schemas.md` | Zod v4 validation schemas for all routes (`src/api/schemas.ts`). |
| `api-health.md` | `/api/health` — DB + Kafka + Resend status (`src/api/health.routes.ts`). |
| `test-setup.md` | Shared test DB connection (`src/test/setup.ts`). |
| `test-factories.md` | `createTestTenant`, `createTestTemplate`, `createTestRule`, etc. (`src/test/factories.ts`). |
| `channels-dispatcher.md` | Channel routing entry point (`src/channels/dispatcher.ts`). |
| `jobs-scheduler.md` | Generic interval-based background job runner (`src/jobs/scheduler.ts`). |
| `lib-channel-config.md` | Per-tenant channel credential resolver (`src/lib/channel-config.ts`). |
| `EXAMPLE.md` | Template showing the expected shape — delete once a real foundation primitive exists. |

## What belongs here

Primitives imported by 3+ modules or that establish a project-wide contract. Examples: config loading, DB pool bootstrap, HTTP server bootstrap, auth middleware, shared error types, logging, feature flags, i18n.

## Mandatory reading rule

`CODING_STANDARDS.md` requires these files to be read **in full** before writing any new code that touches the surface they establish. The individual files in this directory replace the old flat `## Shared Foundation` table in `CODEBASE_CONTEXT.md`.

## How to add a new foundation primitive

1. Filename pattern: `category-slug.md` (e.g. `core-config-loading.md`, `db-pool-singleton.md`, `plugin-auth.md`).
2. Use the What it establishes / Files / When to read shape from `EXAMPLE.md`.
3. Add one row to the `## Catalog` table above.

## Why directory-per-kind

Shared Foundation grows every time a new cross-cutting primitive lands. One row per primitive in a flat table becomes impossible to maintain once the project has 10+ primitives. Directory-per-kind scales — and each file is the right size to read "in full" without triggering context pressure.
