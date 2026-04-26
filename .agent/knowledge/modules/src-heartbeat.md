# src/heartbeat/

## Purpose

Liveness monitoring for external systems. Tenants register heartbeat sources; the checker publishes alert events when a source goes stale.

## Key files

- `src/heartbeat/checker.ts` — Background job: scans `heartbeats` rows where `last_seen_at < now() - interval_minutes` and `alerted_at IS NULL`, publishes a `heartbeat.stale` Kafka event for the tenant, sets `alerted_at`.
- `src/heartbeat/routes.ts` — REST endpoints: register, pulse (update `last_seen_at`), list, delete heartbeats.

## Dependencies

- Upstream: `src/db/`, `src/lib/`, `src/consumer/producer.ts` (publishes alert events).

## Tests

- `src/heartbeat/*.test.ts` — covers stale detection, pulse flow, and tenant scoping.
