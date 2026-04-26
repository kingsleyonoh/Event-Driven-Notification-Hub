# Health Endpoint

## What it establishes

`GET /api/health` returns Postgres + Kafka + Resend status. BetterStack polls this for uptime monitoring.

## Files

- `src/api/health.routes.ts` — single route, no auth required.

## When to read this

Before changing the health response contract (BetterStack monitors specific fields). Before adding a new dependency that should affect health.

## Contract

- No auth required (uptime monitors must call without keys).
- Response shape: `{ ok: boolean, services: { db, kafka, resend } }`.
- Each service check has a 1-2s timeout; the route never blocks > 3s total.
- Returns 200 even when a non-critical service is down (e.g. Resend) — the `services` map carries the truth, not the HTTP status.
