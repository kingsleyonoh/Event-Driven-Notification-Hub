# Event-Driven Notification Hub — Codebase Context

> Last updated: 2026-04-06
> Template synced: 2026-04-06

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.x (strict mode) |
| Runtime | Node.js 22 LTS |
| Framework | Fastify 5.x |
| Message Broker | Apache Kafka (Redpanda for local dev) |
| Database | PostgreSQL 16 |
| ORM | Drizzle ORM |
| Email | Resend API |
| WebSocket | Fastify WebSocket plugin |
| Templating | Handlebars |
| Testing | Vitest + Supertest |
| Logging | Pino (structured JSON) |
| Package Manager | npm |
| Containerization | Docker + Docker Compose |
| Hosting | Docker on Hetzner VPS (behind Traefik) |

## Project Structure

```
notification-hub/
├── src/
│   ├── server.ts                    # Fastify app entry point
│   ├── config.ts                    # Env var loader with validation
│   ├── consumer/
│   │   ├── kafka.ts                 # Kafka consumer setup
│   │   ├── producer.ts             # Shared KafkaJS producer (events API + heartbeat checker)
│   │   ├── router.ts               # Event → rule matching
│   │   └── lag-monitor.ts          # Consumer lag alerting
│   ├── processor/
│   │   ├── pipeline.ts              # Preference checks, dedup, digest routing
│   │   ├── deduplicator.ts
│   │   ├── preferences.ts          # User preference evaluation
│   │   ├── quiet-hours-release.ts   # Release held notifications when quiet hours end
│   │   └── notification-cleanup.ts  # Delete old notifications (retention policy)
│   ├── channels/
│   │   ├── email.ts                 # Resend integration
│   │   ├── email-monitor.ts         # Email failure rate sliding window
│   │   ├── sms.ts                   # SMS stub
│   │   ├── in-app.ts               # WebSocket push
│   │   └── dispatcher.ts           # Channel routing (email/sms/in_app)
│   ├── templates/
│   │   └── renderer.ts             # Handlebars rendering
│   ├── digest/
│   │   └── engine.ts               # Digest batching + sending
│   ├── heartbeat/
│   │   ├── checker.ts              # Background job: find stale → publish events
│   │   └── routes.ts               # Register, pulse, list, delete heartbeats
│   ├── jobs/
│   │   └── scheduler.ts              # Generic background job scheduler
│   ├── api/
│   │   ├── rules.routes.ts
│   │   ├── templates.routes.ts
│   │   ├── preferences.routes.ts
│   │   ├── notifications.routes.ts
│   │   ├── admin.routes.ts           # Admin tenant CRUD (X-Admin-Key)
│   │   ├── events.routes.ts          # Test event publisher
│   │   ├── health.routes.ts
│   │   ├── schemas.ts                # Zod validation schemas
│   │   └── middleware/
│   ├── ws/
│   │   └── handler.ts              # WebSocket connection manager
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema.ts
│   │   └── migrations/
│   └── lib/                         # Shared types, utilities, errors
├── tests/
├── docker-compose.yml               # Redpanda + PostgreSQL (dev)
├── Dockerfile
├── docker-compose.prod.yml
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── drizzle.config.ts
├── .env.example
└── docs/
    └── prd.md
```

## Key Modules

| Module | Purpose | Key Files |
|--------|---------|-----------|
| Consumer | Kafka event ingestion, rule matching, shared producer | `src/consumer/kafka.ts`, `producer.ts`, `router.ts` |
| Processor | Notification pipeline (opt-out, quiet hours, dedup, digest) | `src/processor/pipeline.ts` |
| Channels | Multi-channel delivery (email, SMS, in-app) | `src/channels/email.ts`, `sms.ts`, `in-app.ts` |
| Templates | Handlebars template compilation + rendering | `src/templates/renderer.ts` |
| Digest | Batch notification aggregation + scheduled sending | `src/digest/engine.ts` |
| Heartbeat | Liveness monitoring + stale detection | `src/heartbeat/checker.ts`, `routes.ts` |
| API | REST endpoints for rules, templates, preferences, notifications | `src/api/*.routes.ts` |
| WebSocket | Real-time push notifications to connected clients | `src/ws/handler.ts` |
| Jobs | Background job scheduler (digest, quiet hours, heartbeat, cleanup, monitoring) | `src/jobs/scheduler.ts` |
| Monitoring | Consumer lag + email failure rate alerting | `src/consumer/lag-monitor.ts`, `src/channels/email-monitor.ts` |
| DB | Drizzle ORM schema, migrations, client | `src/db/schema.ts`, `client.ts` |

## Database Schema

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `tenants` | Tenant registry with API keys and config | `id` (TEXT PK), `name`, `api_key` (UNIQUE), `config` (JSONB), `enabled` |
| `notification_rules` | Event → channel routing rules | `event_type`, `channel`, `template_id`, `recipient_type`, `urgency` |
| `templates` | Handlebars message templates per channel | `name` (unique per tenant), `channel`, `subject`, `body` |
| `user_preferences` | Per-user delivery settings | `user_id` (unique per tenant), `opt_out` (JSONB), `quiet_hours` (JSONB), `digest_mode` |
| `notifications` | Delivery log with status tracking | `event_id`, `recipient`, `channel`, `payload` (JSONB), `status` (pending/sent/failed/queued_digest/skipped/held), `skip_reason` |
| `digest_queue` | Pending digest items for batch sending | `user_id`, `notification_id`, `scheduled_for`, `sent` |
| `heartbeats` | Liveness monitoring for external systems | `source_name`, `interval_minutes`, `last_seen_at`, `alerted_at`, `enabled` |

## External Integrations

| Service | Purpose | Auth Method |
|---------|---------|------------|
| Kafka/Redpanda | Consume domain events (inbound) | Broker connection string |
| Resend API | Email delivery (outbound) | API key (`RESEND_API_KEY`) |
| WebSocket | In-app push notifications (outbound) | userId query param |
| BetterStack | Uptime monitoring on `/api/health` | External poll |

## Environment Variables

| Variable | Purpose | Source |
|----------|---------|--------|
| `PORT` | Server port | `.env` |
| `DATABASE_URL` | PostgreSQL connection string | `.env` |
| `KAFKA_BROKERS` | Kafka broker addresses | `.env` |
| `KAFKA_GROUP_ID` | Consumer group ID | `.env` |
| `KAFKA_TOPICS` | Topic glob pattern | `.env` |
| `RESEND_API_KEY` | Resend email API key | `.env` |
| `RESEND_FROM` | Sender email address | `.env` |
| `API_KEYS` | Comma-separated valid API keys (legacy fallback) | `.env` |
| `ADMIN_API_KEY` | Admin key for `/api/admin/*` endpoints | `.env` |
| `DEDUP_WINDOW_MINUTES` | Deduplication time window | `.env` |
| `DIGEST_SCHEDULE` | Digest frequency (hourly/daily) | `.env` |
| `QUIET_HOURS_CHECK_INTERVAL_MS` | Quiet hour release check interval | `.env` |
| `NOTIFICATION_RETENTION_DAYS` | Days before notification cleanup | `.env` |

## Commands

| Action | Command |
|--------|---------|
| Dev server | `npm run dev` |
| Run tests | `npx vitest run` |
| Run tests (watch) | `npx vitest` |
| Lint/check | `npx tsc --noEmit` |
| Build | `npm run build` |
| Migrate DB | `npx drizzle-kit migrate` |
| Seed DB | `npm run db:seed` |
| Create topics | `npm run topics:create` |
| Docker (dev) | `docker compose up -d` |

## Key Patterns & Conventions

- File naming: `kebab-case.ts` for modules, `camelCase` for variables/functions
- Error handling: `AppError` subclasses + `toErrorResponse()` → `{ error: { code, message, details } }`
- Auth: `X-API-Key` → tenant lookup → `request.tenantId` injected; `X-Admin-Key` for `/api/admin/*`
- Rate limiting: `@fastify/rate-limit`, `global: false`, per-route via `config.rateLimit`
- Validation: Zod v4 schemas in `src/api/schemas.ts`
- Pagination: cursor-based on notification listings
- Import order: std → third-party → local, blank line between groups


## Gotchas & Lessons Learned

> Discovered during implementation. Added automatically by `/implement-next` Step 9.3.

| Date | Area | Gotcha | Discovered In |
|------|------|--------|---------------|
| 2026-03-31 | config | dotenv in server.ts only, not config.ts — tests pollute process.env otherwise | config.ts TDD |
| 2026-03-31 | infra | Redpanda external listener on port 19092, not 9092 | Docker setup |
| 2026-03-31 | db | Docker PG mapped to port 5433 (local PG conflicts on 5432) | DB migration |
| 2026-03-31 | db | `drizzle-kit migrate` hangs on Windows — use `docker exec psql` | DB migration |
| 2026-03-31 | api | `@fastify/rate-limit` errorResponseBuilder conflicts with setErrorHandler — handle 429 in error handler | Rate limiter |
| 2026-03-31 | db | Drizzle wraps PG errors — unique violations at `err.cause.code === '23505'` | Rules CRUD |

## Shared Foundation (MUST READ before any implementation)

> These files define the project's shared patterns, configuration, and utilities.
> The AI MUST read these **in full** before writing ANY new code. Never recreate what exists here.

| Category | File(s) | What it establishes |
|----------|---------|-------------------|
| DB client | `src/db/client.ts` | PostgreSQL connection via Drizzle ORM |
| DB schema | `src/db/schema.ts` | All table definitions, types, relations |
| Config | `src/config.ts` | Environment variable loading and validation |
| Error handling | `src/lib/errors.ts` | Centralized error types and handler |
| Server setup | `src/server.ts` | Fastify app creation, plugin registration |
| Auth middleware | `src/api/middleware/auth.ts` | API key → tenant lookup, injects `request.tenantId` + `request.tenant` |
| Admin auth | `src/api/middleware/admin-auth.ts` | X-Admin-Key validation for `/api/admin/*` routes |
| Error handler | `src/api/middleware/error-handler.ts` | Global Fastify error handler, formats AppError → standard response |
| Rate limiter | `src/api/middleware/rate-limiter.ts` | @fastify/rate-limit with per-route config overrides |
| Validation schemas | `src/api/schemas.ts` | Zod v4 schemas for all API endpoints |
| Health routes | `src/api/health.routes.ts` | Health check with PG, Kafka, Resend status |
| Test setup | `src/test/setup.ts` | Shared test DB connection (db + sql) |
| Test factories | `src/test/factories.ts` | createTestTenant, createTestTemplate, createTestRule, createTestPreferences, createTestNotification, cleanupTestData |
| Channel dispatcher | `src/channels/dispatcher.ts` | Routes channel → handler (email, sms, in_app) with DispatchConfig |
| Job scheduler | `src/jobs/scheduler.ts` | Generic interval-based background job runner with start/stop |

## Deep References

| Topic | Where to look |
|-------|--------------|
| Kafka consumer + producer | `src/consumer/` |
| Notification pipeline | `src/processor/` |
| Channel handlers | `src/channels/` |
| Template rendering | `src/templates/` |
| Digest engine | `src/digest/` |
| Heartbeat monitoring | `src/heartbeat/` |
| Background jobs | `src/jobs/` |
| Monitoring (lag + email) | `src/consumer/lag-monitor.ts`, `src/channels/email-monitor.ts` |
| REST API routes | `src/api/` |
| WebSocket | `src/ws/` |
| Database | `src/db/` |
| Tests | `src/**/*.test.ts` |
