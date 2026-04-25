# AppError Hierarchy

## What it establishes

Centralized error types. Every error returned to clients flows through `AppError` subclasses → `toErrorResponse()` to produce `{ error: { code, message, details } }`.

## Files

- `src/lib/errors.ts` — `AppError` base + 6 subclasses (`NotFoundError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `ConflictError`, `RateLimitedError`) + `toErrorResponse()`.

## When to read this

Before adding any `throw` in a route handler, middleware, or service that may reach the client boundary.

## Contract

- Throw `AppError` subclasses, NOT raw `Error`.
- The error `code` is machine-readable (e.g. `RULE_NOT_FOUND`) — keep stable; clients pattern-match on it.
- `details` is optional, JSON-serializable, never contains secrets / stack traces.
- The global error handler in `src/api/middleware/error-handler.ts` is the only caller of `toErrorResponse()`.
