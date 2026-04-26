# Admin Auth Middleware

## What it establishes

Admin endpoint guard for `/api/admin/*` routes. Gates tenant CRUD behind a separate header so a leaked tenant API key never grants admin access.

## Files

- `src/api/middleware/admin-auth.ts` — `onRequest` hook scoped to `/api/admin/*`. Reads `X-Admin-Key` header, compares against `ADMIN_API_KEY` env var. Constant-time comparison.

## When to read this

Before adding a new admin endpoint. Before changing the admin auth scheme.

## Contract

- Header: `X-Admin-Key: <env ADMIN_API_KEY>`.
- Missing / wrong key → 401 `UnauthorizedError`.
- Admin requests do NOT have `request.tenantId` — admin operations explicitly target tenants by `id` in the URL.
- Used to create / update / delete tenants and rotate `api_key`.
