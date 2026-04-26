# src/jobs/

## Purpose

Generic interval-based background job scheduler — single point of registration for digest, quiet-hours release, heartbeat checker, notification cleanup, and monitoring jobs.

## Key files

- `src/jobs/scheduler.ts` — `start({ jobs })` accepts an array of `{ name, intervalMs, run }` and schedules each via `setInterval`. Handles shutdown gracefully (cancels intervals on SIGTERM). Exports `stop()` for tests.

## Dependencies

- Upstream: `src/lib/` (logger).
- Downstream: called by `src/server.ts` after Fastify starts.

## Tests

- `src/jobs/scheduler.test.ts` — covers job registration, interval timing (fake timers), shutdown.
