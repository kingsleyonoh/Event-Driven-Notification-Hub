# DB Client Singleton

## What it establishes

PostgreSQL connection lifecycle via Drizzle ORM. One connection pool per process; tests share the pool via `src/test/setup.ts`.

## Files

- `src/db/client.ts` — `createDb(url)` returns `{ db, sql }`.

## When to read this

Before adding any code that:
- Imports `db` or `sql`.
- Creates a new `Pool` or raw `postgres` connection.
- Touches connection lifecycle (close, retry, etc.).

## Contract

- Always import `db` from the application's wired client (`src/server.ts` → `db`) — never call `createDb()` outside of `src/server.ts` or `src/test/setup.ts`.
- The Drizzle `db` is the public surface; the raw `sql` is for migrations and rare advanced queries.
