# Test Setup (Vitest)

## What it establishes

Shared test DB connection used across the suite. Eliminates per-test connection churn.

## Files

- `src/test/setup.ts` — exports `db`, `sql`, and a `closeDb()` helper. Reads `TEST_DATABASE_URL` from `.env.local` (defaults to local Docker Postgres on port 5433).

## When to read this

Before adding any new test file that hits the database. Before changing how the test DB is provisioned.

## Contract

- Tests import `db` from this module — never call `createDb()` directly.
- `vitest.config.ts` runs `setup.ts` once per worker.
- The connection is closed in a global teardown; individual tests do not close.
