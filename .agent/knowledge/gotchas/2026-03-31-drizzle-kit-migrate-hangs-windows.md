# `drizzle-kit migrate` hangs on Windows

- **Symptom:** `npx drizzle-kit migrate` hangs forever on Windows / Git Bash, never completes.
- **Cause:** `drizzle-kit migrate` spawns a child process to run migrations and Windows interactive-shell semantics confuse it. The CLI never sees the child's exit signal.
- **Solution:** Generate the migration normally (`npx drizzle-kit generate`), then APPLY it via `docker exec`:
  ```bash
  docker exec -i <postgres_container> psql -U postgres -d notification_hub < src/db/migrations/<file>.sql
  ```
  Or use a one-shot Node script that runs the SQL directly via the `postgres` package.
- **Discovered in:** Event-Driven Notification Hub, DB migration (2026-03-31).
- **Affects:** Windows / Git Bash environments only. Works fine on macOS / Linux.
