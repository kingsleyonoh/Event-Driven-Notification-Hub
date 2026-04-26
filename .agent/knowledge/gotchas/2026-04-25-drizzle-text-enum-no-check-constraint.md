# Drizzle `text { enum: [...] }` does not emit a Postgres CHECK

## Symptom

Migration to "extend the existing `notifications.status` CHECK constraint" hit `NOTICE: constraint "notifications_status_check" of relation "notifications" does not exist, skipping`. Querying `pg_constraint` confirmed: 0 rows for any constraint name matching `%status%` on the `notifications` table.

But `src/db/schema.ts` plainly declared:

```ts
status: text('status', {
  enum: ['pending', 'sent', 'failed', 'queued_digest', 'skipped', 'held'],
}).notNull(),
```

If the column had a real CHECK constraint, the assumption was the constraint name would follow the project's `<table>_<column>_check` convention — but Drizzle never generated one.

## Cause

Drizzle's `text(name, { enum: [...] })` is purely a TypeScript type-level annotation. It narrows the inferred TypeScript union for inserts/selects to the enum values, but the SQL DDL it emits is just `text` (no CHECK, no Postgres `enum` type). The database happily accepts any string at runtime — only the application layer enforces the enum.

Discovered while implementing Phase 7 H5 (sandbox mode) — the spec said "extend the existing CHECK constraint to allow `sent_sandbox`," but no such constraint existed on either `notification_hub` or `notification_hub_test`.

## Solution

When you actually want the database to enforce a status enum (defense in depth — catches buggy raw SQL or out-of-band inserts), write an explicit migration:

```sql
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_status_check";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_status_check"
  CHECK (status IN ('pending','sent','sent_sandbox','failed','queued_digest','skipped','held'));
```

Use `DROP CONSTRAINT IF EXISTS` first so the migration is idempotent across environments where the constraint may or may not pre-exist. Apply to both `notification_hub` and `notification_hub_test` per the existing `2026-04-25-test-db-needs-separate-alter.md` gotcha.

Alternative (heavier): switch the column to a Drizzle `pgEnum` — that DOES emit a real Postgres `enum` type. Trade-off: enum changes then require `ALTER TYPE ... ADD VALUE ...` instead of editing a CHECK list, which is awkward when removing values is needed.

## Discovered in

Phase 7 batch 014 — H5 sandbox mode per tenant. Adding `sent_sandbox` to the status enum.

## Affects

Drizzle ORM + PostgreSQL. Any project using `text(name, { enum: [...] })` and assuming database-level enum enforcement.
