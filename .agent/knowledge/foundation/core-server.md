# Fastify App Bootstrap

## What it establishes

Fastify app construction, plugin registration order, and listen lifecycle.

## Files

- `src/server.ts` — entry point. Loads dotenv, calls `loadConfig()`, builds the Fastify app, registers plugins in a fixed order, registers routes, starts the job scheduler, listens.

## When to read this

Before adding any new plugin, route group, or startup hook. Plugin order matters — error handler and rate limiter must come before route handlers.

## Contract

Plugin registration order:
1. Error handler (`src/api/middleware/error-handler.ts`)
2. Rate limiter (`src/api/middleware/rate-limiter.ts`)
3. Admin auth (`src/api/middleware/admin-auth.ts` — scoped to `/api/admin/*`)
4. Tenant auth (`src/api/middleware/auth.ts` — scoped to all other tenant-facing routes)
5. WebSocket plugin (`src/ws/handler.ts`)
6. Route plugins (`src/api/*.routes.ts`)

All middleware uses the `fastify-plugin` (fp) wrapper so encapsulation breaks correctly.
