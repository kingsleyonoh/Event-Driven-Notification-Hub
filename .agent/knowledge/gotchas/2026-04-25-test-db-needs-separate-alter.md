# Test DB needs a separate ALTER from dev DB

## Symptom

After applying a Drizzle migration via `docker exec ... psql -U postgres -d notification_hub -c 'ALTER TABLE ...'`, the dev DB worked fine but the regression suite broke with:

```
column "<new_column>" of relation "templates" does not exist
```

across ~21 tests in `notifications`, `templates`, `admin`, and `scripts` test files.

## Cause

`src/test/setup.ts` reads `TEST_DATABASE_URL` from `.env.local` which points at `notification_hub_test` — a **separate physical database** from `notification_hub` (the dev DB). When Windows-blocked from running `npx drizzle-kit migrate`, the manual `docker exec ... -c "ALTER TABLE ..."` only targets the dev DB. The test DB remains on the old schema.

## Solution

Run the same ALTER against `notification_hub_test`:

```bash
docker exec notif-hub-postgres psql -U postgres -d notification_hub_test -c 'ALTER TABLE templates ADD COLUMN attachments_config JSONB DEFAULT NULL;'
```

After this, regression goes green.

**For future schema-changing batches:** apply the migration's SQL to BOTH `notification_hub` AND `notification_hub_test` whenever `drizzle-kit migrate` is bypassed. Standard pattern when running on Windows with the existing drizzle-kit hang gotcha (see `2026-03-31-drizzle-kit-migrate-hangs-windows.md`).

## Discovered in

Phase 7 batch 006 — H1 attachments_config column on `templates`.

## Affects

PostgreSQL + Drizzle + Vitest. Any project that maintains a separate test DB and bypasses `drizzle-kit migrate` for migration application.
