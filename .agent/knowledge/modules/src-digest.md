# src/digest/

## Purpose

Batch notifications into digest emails for users with `digest_mode != 'immediate'`.

## Key files

- `src/digest/engine.ts` — Hourly / daily digest worker. Finds `digest_queue` rows where `scheduled_for <= now() AND sent = false`, groups by user, renders the digest template, sends, marks `sent = true`.

## Dependencies

- Upstream: `src/db/`, `src/lib/`, `src/channels/`, `src/templates/`.

## Tests

- `src/digest/engine.test.ts` — covers grouping, scheduled_for boundary, partial-send recovery (some succeed, some fail).
