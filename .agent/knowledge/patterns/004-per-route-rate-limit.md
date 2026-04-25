# Per-Route Rate Limiting

## Purpose

Apply different rate limits to different surfaces (e.g. event publish endpoint vs. read-heavy listing endpoint).

## When to use

- Any new route where the default global rate limit doesn't fit.

## How it works

- `@fastify/rate-limit` is registered with `global: false` in `src/api/middleware/rate-limiter.ts`.
- Each route opts in via `config.rateLimit`:
  ```ts
  fastify.post('/events', {
    config: { rateLimit: { max: 200, timeWindow: '1 minute' } },
    handler: ...
  });
  ```
- 429 responses are emitted by the global error handler (NOT the rate limiter's `errorResponseBuilder`) — see gotcha `2026-03-31-fastify-rate-limit-error-handler-conflict.md`.

## Cross-references

- Foundation: `.agent/knowledge/foundation/api-rate-limiter.md`
- Gotcha: `.agent/knowledge/gotchas/2026-03-31-fastify-rate-limit-error-handler-conflict.md`
