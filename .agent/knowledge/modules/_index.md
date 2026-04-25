# Modules — Index

> **One file per module.** This index is a human-readable catalog, rewritten by the AI whenever a sibling file is added, renamed, or removed. Never append to a single growing table — write a new sibling instead. See `.agent/rules/CODING_STANDARDS.md` — "Append-Only Knowledge Files Banned."

## Catalog

| File | Summary |
|------|---------|
| `src-consumer.md` | Kafka event ingestion, rule matching, shared producer (`src/consumer/`). |
| `src-processor.md` | Notification pipeline — preferences, dedup, quiet hours, digest routing (`src/processor/`). |
| `src-channels.md` | Multi-channel delivery (email, sms, in-app, telegram) + dispatcher (`src/channels/`). |
| `src-templates.md` | Handlebars rendering with strict undefined handling (`src/templates/`). |
| `src-digest.md` | Hourly/daily digest batching + sending (`src/digest/`). |
| `src-heartbeat.md` | Liveness monitoring + stale detection + alert publishing (`src/heartbeat/`). |
| `src-api.md` | REST endpoints (rules, templates, preferences, notifications, admin, events, health) + middleware (`src/api/`). |
| `src-ws.md` | WebSocket connection manager for in-app push (`src/ws/`). |
| `src-jobs.md` | Generic background job scheduler (`src/jobs/`). |
| `src-monitoring.md` | Consumer lag monitor + email failure-rate monitor. |
| `src-db.md` | Drizzle ORM client, schema, migrations (`src/db/`). |
| `EXAMPLE.md` | Template showing the expected shape — delete once a real module exists. |

## How to add a new module

1. Filename pattern: mirror the source path, converting slashes to hyphens (e.g. `src/documents/composer/` → `src-documents-composer.md`).
2. Use the Purpose / Key files / Dependencies / Tests shape from `EXAMPLE.md`.
3. Add one row to the `## Catalog` table above.
4. When the module is removed or renamed, delete or rename this file in the same batch — never leave stale module files.

## Why directory-per-kind

A `## Key Modules` table in `CODEBASE_CONTEXT.md` has to cover every module in the project. Small projects get away with a single table; real projects accumulate 20-100 modules and the table becomes unreadable. One file per module keeps each description scoped to its own context, and deletion is trivial when the module is removed.
