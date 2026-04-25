# Tenant Auth Middleware

## What it establishes

`X-API-Key` → tenant lookup → `request.tenantId` injection. Every non-health, non-admin route depends on this.

## Files

- `src/api/middleware/auth.ts` — `onRequest` hook (via `fastify-plugin`). Looks up `tenants` row by `api_key`, rejects if `enabled = false`, injects `request.tenantId` and `request.tenant`.

## When to read this

Before writing any route that touches tenant-scoped data. Before adding a new auth scheme.

## Contract

- Header: `X-API-Key: <tenant.api_key>`.
- Failure modes: missing → 401 `UnauthorizedError`; invalid / disabled → 403 `ForbiddenError`.
- Every downstream query MUST include `where(eq(table.tenantId, request.tenantId))`. Cross-tenant reads are an architectural violation (see `CODING_STANDARDS_TESTING.md` — Multi-Tenant Fixtures Mandatory).
