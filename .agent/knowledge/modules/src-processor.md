# src/processor/

## Purpose

The notification pipeline — opt-out checks, quiet hours, deduplication, and digest routing decisions for every notification before it reaches a channel.

## Key files

- `src/processor/pipeline.ts` — Main pipeline. Takes a routed event + rule + recipient; emits a `notifications` row with the right `status`.
- `src/processor/deduplicator.ts` — Time-windowed dedup: same `(tenant_id, event_id, recipient, channel)` within `DEDUP_WINDOW_MINUTES` → `status: skipped, skip_reason: 'duplicate'`.
- `src/processor/preferences.ts` — Reads `user_preferences.opt_out` JSONB to decide whether the user opted out of this channel/event_type.
- `src/processor/quiet-hours-release.ts` — Background job: finds notifications with `status: held` whose tenant's quiet-hours window just ended, dispatches them.
- `src/processor/notification-cleanup.ts` — Background job: deletes notifications older than `NOTIFICATION_RETENTION_DAYS`.

## Dependencies

- Upstream: `src/db/`, `src/lib/`, `src/channels/`, `src/templates/`.

## Tests

- `src/processor/*.test.ts` — covers each pipeline step with multi-tenant fixtures.

## Cross-references

- Schema: `notifications.status` enum in `CODEBASE_CONTEXT_SCHEMA.md`.
