# Global Error Handler

## What it establishes

Single Fastify error handler that maps any thrown error to a consistent JSON response shape.

## Files

- `src/api/middleware/error-handler.ts` — `app.setErrorHandler((err, req, reply) => ...)`. Detects `AppError` subclasses → calls `toErrorResponse()`. Detects rate-limit 429s. Maps Zod errors → `ValidationError` (400). Unknown → 500 `INTERNAL_ERROR` (logs full details server-side).

## When to read this

Before adding any try/catch in a route handler — usually unnecessary if the error is an `AppError`. Before changing the error response contract.

## Contract

- The error handler is registered FIRST in `server.ts` plugin order.
- Response shape is ALWAYS `{ error: { code, message, details } }` — clients depend on this.
- Stack traces NEVER leak to clients in production.
