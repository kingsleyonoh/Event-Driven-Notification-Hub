# Drizzle wraps PG errors — unique violations live at `err.cause.code`

- **Symptom:** Catching `err.code === '23505'` to detect unique-constraint violations doesn't fire — the original Postgres error code is not at the top level.
- **Cause:** Drizzle wraps the underlying `postgres` driver error in its own error type. The original error (with the `'23505'` PG sqlstate) is at `err.cause.code`, not `err.code`.
- **Solution:** Check `err.cause?.code === '23505'`. Wrap in a small helper to keep route handlers clean:
  ```ts
  function isUniqueViolation(err: unknown): boolean {
    return (err as any)?.cause?.code === '23505';
  }
  ```
  Use this in the rules / templates / preferences routes when handling `INSERT ... UNIQUE` collisions to return `409 ConflictError` instead of `500`.
- **Discovered in:** Event-Driven Notification Hub, Rules CRUD (2026-03-31).
- **Affects:** All routes/services that catch DB errors thrown by Drizzle.
