# Job Scheduler

## What it establishes

Generic interval-based background job runner. Single registration point for digest, quiet-hours release, heartbeat checker, notification cleanup, and monitoring jobs.

## Files

- `src/jobs/scheduler.ts` — `start({ jobs })` / `stop()` API.

## When to read this

Before adding any new background job. Before changing how scheduling, shutdown, or error isolation works.

## Contract

- A job is `{ name, intervalMs, run }` — `run()` returns `Promise<void>`.
- Errors thrown inside `run()` are logged but do not crash the process; the next interval tick continues.
- `stop()` cancels all timers and waits for in-flight jobs to settle (used in tests).
- Wired in `src/server.ts` AFTER Fastify is listening.
