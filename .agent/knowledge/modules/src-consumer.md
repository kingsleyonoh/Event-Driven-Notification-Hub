# src/consumer/

## Purpose

Kafka event ingestion, rule matching, and shared producer for outbound events (heartbeat alerts, etc.).

## Key files

- `src/consumer/kafka.ts` — KafkaJS consumer setup, topic glob matching, message dispatch into the processor pipeline.
- `src/consumer/producer.ts` — Shared KafkaJS producer used by `/api/events` test publisher and the heartbeat checker.
- `src/consumer/router.ts` — Matches incoming events against `notification_rules` rows for the tenant.
- `src/consumer/lag-monitor.ts` — Periodically checks consumer group lag, alerts on threshold exceeded.

## Dependencies

- Upstream: `kafkajs`, `src/db/`, `src/lib/`.
- Downstream: `src/processor/pipeline.ts` (consumes routed events), `src/heartbeat/checker.ts` (uses producer).

## Tests

- `src/consumer/*.test.ts` — covers topic matching, deserialization, rule matching, and lag-monitor windowing.

## Cross-references

- Pattern: `.agent/knowledge/patterns/003-tenant-auth-injection.md` (events arrive without a tenantId; the router resolves it from the topic + rule).
