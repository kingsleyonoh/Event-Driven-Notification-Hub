# Gotchas — Index

> **One file per gotcha.** This index is a human-readable catalog, rewritten by the AI whenever a sibling file is added, renamed, or removed. Never append to a single growing table — write a new sibling instead. See `.agent/rules/CODING_STANDARDS.md` — "Append-Only Knowledge Files Banned."

## Catalog

| File | Summary |
|------|---------|
| `2026-03-31-dotenv-server-only.md` | Load dotenv only in `server.ts` — putting it in `config.ts` pollutes test process.env between files. |
| `2026-03-31-redpanda-external-port-19092.md` | Redpanda external listener is on 19092, not 9092. Local clients must use `localhost:19092`. |
| `2026-03-31-docker-pg-port-5433.md` | Docker Postgres maps to host port 5433 to avoid conflicts with locally-installed Postgres on 5432. |
| `2026-03-31-drizzle-kit-migrate-hangs-windows.md` | `drizzle-kit migrate` hangs on Windows — apply migrations via `docker exec psql` instead. |
| `2026-03-31-fastify-rate-limit-error-handler-conflict.md` | `@fastify/rate-limit` `errorResponseBuilder` conflicts with `setErrorHandler` — handle 429 in the global error handler instead. |
| `2026-03-31-drizzle-pg-error-cause-code.md` | Drizzle wraps PG errors — unique-violation `'23505'` lives at `err.cause.code`, not `err.code`. |
| `2026-04-25-test-db-needs-separate-alter.md` | When bypassing `drizzle-kit migrate`, apply ALTERs to BOTH `notification_hub` and `notification_hub_test` — they're separate physical DBs. |
| `2026-04-25-drizzle-text-enum-no-check-constraint.md` | Drizzle's `text { enum: [...] }` is TS-only — emits no Postgres CHECK. Add an explicit `ADD CONSTRAINT ... CHECK` migration if DB-level enum enforcement is needed. |
| `2026-04-26-sandbox-requires-fake-api-key.md` | H5 sandbox-only tenants silently bypass sandbox if `apiKey` is missing — `emailChannelConfigSchema` requires it; resolver returns null on validation fail; dispatcher falls back to env-var Resend. Workaround: placeholder apiKey. Proper fix: `superRefine` to make apiKey conditional on sandbox. |
| `EXAMPLE.md` | Template showing the expected shape — delete once a real gotcha exists. |

## How to add a new gotcha

1. Filename pattern: `YYYY-MM-DD-short-slug.md` (date of discovery + kebab-case slug).
2. Use the Symptom / Cause / Solution / Discovered in / Affects shape from `EXAMPLE.md` — matches `knowledge/gotchas-by-stack/` format so entries promote cleanly via `/harvest-gotchas`.
3. Add one row to the `## Catalog` table above.
4. If the gotcha is cross-project (would bite other projects on the same stack), queue it for harvest.

## Why directory-per-kind

A single `## Gotchas & Lessons Learned` table grows monotonically as every batch appends a row. The table hits 50 rows, then 200, then a size-limit platform truncates the file silently. New file per gotcha eliminates the problem — and git history per gotcha becomes atomic. See `MAINTAINING.md` — "Append-Only Knowledge Files Banned."
