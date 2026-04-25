# DB Schema (Drizzle)

## What it establishes

All Drizzle table definitions, types, and relations. The single source of truth for the database shape.

## Files

- `src/db/schema.ts` — exports `tenants`, `notificationRules`, `templates`, `userPreferences`, `notifications`, `digestQueue`, `heartbeats`, plus inferred types.

## When to read this

Before adding any code that:
- Queries a table (so you know the column names and types).
- Adds a new column or table (so the migration is consistent with existing patterns).
- Touches `tenants.config` JSONB shape (per-tenant channel credentials).

## Contract

- Every data-bearing table has `tenant_id` (FK CASCADE on tenants).
- Every UNIQUE constraint that's per-tenant is `(tenant_id, X)`, not just `(X)`.
- All timestamps are `TIMESTAMPTZ` with `defaultNow()`.
- See `.agent/rules/CODEBASE_CONTEXT_SCHEMA.md` for the human-readable schema reference.
