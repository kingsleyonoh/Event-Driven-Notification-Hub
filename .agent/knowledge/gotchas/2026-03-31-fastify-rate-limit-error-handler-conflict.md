# `@fastify/rate-limit` errorResponseBuilder conflicts with setErrorHandler

- **Symptom:** Rate-limited requests (HTTP 429) bypass the global error handler and return a default Fastify error shape, breaking the `{ error: { code, message, details } }` response contract.
- **Cause:** `@fastify/rate-limit`'s `errorResponseBuilder` runs BEFORE the registered global `setErrorHandler`. Setting `errorResponseBuilder` and a global error handler simultaneously double-wraps the response.
- **Solution:** Do NOT pass `errorResponseBuilder` to `@fastify/rate-limit`. Let it throw a `FastifyError` with `statusCode: 429`. Handle the 429 case explicitly inside the global error handler in `src/api/middleware/error-handler.ts` — detect `error.statusCode === 429` and emit `{ error: { code: 'RATE_LIMITED', message, details } }`.
- **Discovered in:** Event-Driven Notification Hub, rate limiter setup (2026-03-31).
- **Affects:** All routes that opt-in to per-route `config.rateLimit`.
