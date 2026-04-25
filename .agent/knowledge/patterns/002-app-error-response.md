# AppError Response Shape

## Purpose

Every API error response uses a single, predictable JSON shape so clients can pattern-match on `error.code`.

## When to use

- Any time a route handler, middleware, or service throws to the client boundary.

## How it works

- Define error subclasses extending `AppError` in `src/lib/errors.ts` (e.g. `NotFoundError`, `ConflictError`, `ValidationError`, `RateLimitedError`).
- Each subclass sets a `code` (string), `statusCode`, and optional `details` (any JSON-serializable).
- The global error handler in `src/api/middleware/error-handler.ts` calls `toErrorResponse(err)` to produce:
  ```json
  { "error": { "code": "RULE_NOT_FOUND", "message": "...", "details": { ... } } }
  ```
- Unknown errors map to `INTERNAL_ERROR` with HTTP 500 and a generic message — full details are logged server-side via Pino, never returned to clients.

## Example

```ts
throw new ConflictError('RULE_DUPLICATE', 'A rule for this event already exists', { eventType });
```

## Cross-references

- Foundation: `.agent/knowledge/foundation/lib-errors.md`
- Module: `.agent/knowledge/modules/src-api-middleware.md`
