# Monitoring (consumer lag + email failure rate)

## Purpose

Background monitors that watch the Kafka consumer group lag and the email failure rate, emitting alerts when thresholds are exceeded.

## Key files

- `src/consumer/lag-monitor.ts` — Periodically queries Redpanda for consumer-group lag; alerts if lag exceeds threshold.
- `src/channels/email-monitor.ts` — Sliding-window failure-rate tracker for Resend deliveries; alerts when rate > N% in last M minutes.

## Dependencies

- Upstream: `kafkajs` (admin client for lag), `src/db/` (notification status counts).
- Downstream: emits log warnings; future: publishes alert events to a `monitoring.alerts` Kafka topic.

## Tests

- Co-located `*.test.ts` files cover lag math, sliding window, threshold transitions.
