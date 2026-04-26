# Rate Limiter

## What it establishes

`@fastify/rate-limit` with `global: false` so each route opts in via `config.rateLimit`. Rejects 429 via the global error handler, NOT via the rate-limiter's own `errorResponseBuilder`.

## Files

- `src/api/middleware/rate-limiter.ts` — `app.register(fastifyRateLimit, { global: false, ...defaults })`.

## When to read this

Before adding a new rate-limited route. Before tuning the default limits.

## Contract

- Global limit is OFF — `config.rateLimit` per-route is opt-in.
- Default limits target read-heavy endpoints; event publishing has higher limits (200/min) per `progress.md`.
- DO NOT pass `errorResponseBuilder` — see gotcha `2026-03-31-fastify-rate-limit-error-handler-conflict.md`.
