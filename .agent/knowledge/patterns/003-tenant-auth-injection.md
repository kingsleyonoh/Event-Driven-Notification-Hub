# Tenant Auth: X-API-Key → Tenant Injection

## Purpose

Resolve tenant identity once per request from the API key and inject it into the Fastify request scope so route handlers never re-resolve it.

## When to use

- All non-health, non-admin routes.

## How it works

- `src/api/middleware/auth.ts` registers an `onRequest` hook (via `fastify-plugin`).
- Reads `X-API-Key` header → `SELECT * FROM tenants WHERE api_key = $1 AND enabled = true`.
- On match: assigns `request.tenantId = tenant.id` and `request.tenant = tenant`.
- On miss / disabled: throws `UnauthorizedError` (`401`).
- Admin routes under `/api/admin/*` use a separate `admin-auth.ts` plugin requiring `X-Admin-Key === ADMIN_API_KEY` env var.
- Every downstream query MUST include `where(eq(table.tenantId, request.tenantId))`.

## Cross-references

- Foundation: `.agent/knowledge/foundation/auth-tenant-middleware.md`
- Foundation: `.agent/knowledge/foundation/auth-admin-middleware.md`
