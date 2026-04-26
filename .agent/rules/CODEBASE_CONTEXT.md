# Event-Driven Notification Hub — Codebase Context

> Last updated: 2026-04-25
> Template synced: 2026-04-25

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
│   │   ├── producer.ts              # Shared KafkaJS producer (events API + heartbeat checker)
│   │   ├── router.ts                # Event → rule matching
│   │   └── lag-monitor.ts           # Consumer lag alerting
│   ├── processor/
│   │   ├── pipeline.ts              # Preference checks, dedup, digest routing
│   │   ├── deduplicator.ts
│   │   ├── preferences.ts           # User preference evaluation
│   │   ├── quiet-hours-release.ts   # Release held notifications when quiet hours end
│   │   └── notification-cleanup.ts  # Delete old notifications (retention policy)
│   ├── channels/
│   │   ├── email.ts                 # Resend integration
│   │   ├── email-monitor.ts         # Email failure rate sliding window
│   │   ├── sms.ts                   # SMS stub
│   │   ├── in-app.ts                # WebSocket push
│   │   ├── telegram.ts              # Telegram send via Bot API
│   │   ├── telegram-bot.ts          # Telegram bot polling worker (/start link flow)
│   │   └── dispatcher.ts            # Channel routing (email/sms/in_app/telegram)
│   ├── templates/
│   │   └── renderer.ts              # Handlebars rendering
│   ├── digest/
│   │   └── engine.ts                # Digest batching + sending
│   ├── heartbeat/
│   │   ├── checker.ts               # Background job: find stale → publish events
│   │   └── routes.ts                # Register, pulse, list, delete heartbeats
│   ├── jobs/
│   │   └── scheduler.ts             # Generic background job scheduler
│   ├── api/
│   │   ├── rules.routes.ts
│   │   ├── templates.routes.ts
│   │   ├── preferences.routes.ts
│   │   ├── notifications.routes.ts
│   │   ├── admin.routes.ts          # Admin tenant CRUD (X-Admin-Key)
│   │   ├── events.routes.ts         # Test event publisher
│   │   ├── health.routes.ts
│   │   ├── schemas.ts               # Zod validation schemas
│   │   └── middleware/
│   ├── ws/
│   │   └── handler.ts               # WebSocket connection manager
│   ├── db/
│   │   ├── client.ts
│   │   ├── schema.ts
│   │   └── migrations/
│   ├── scripts/
│   │   ├── seed.ts                  # Database seed (demo data)
│   │   ├── create-topics.ts         # Kafka topic creation
│   │   └── setup-personal.ts        # Personal tenant setup script
│   └── lib/                         # Shared types, utilities, errors, channel-config
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
    └── notification-hub_prd.md
```

## Database Schema

> See `CODEBASE_CONTEXT_SCHEMA.md` for the full schema table.

## Key Modules

> **Modules live in `.agent/knowledge/modules/` — one file per module.** See `modules/_index.md` for the catalog. Do NOT add a flat table here — it's a banned append-only pattern. See `CODING_STANDARDS.md` — "Append-Only Knowledge Files Banned."

## External Integrations

| Service | Purpose | Auth Method |
|---------|---------|------------|
| Kafka/Redpanda | Consume domain events (inbound) | Broker connection string |
| Resend API | Email delivery (outbound) | API key (`RESEND_API_KEY` global, `tenants.config.channels.email.resendKey` per-tenant) |
| WebSocket | In-app push notifications (outbound) | userId query param |
| Telegram Bot API | Telegram message delivery + /start link flow (outbound) | Bot token per tenant (`tenants.config.channels.telegram.botToken`) |
| BetterStack | Uptime monitoring on `/api/health` | External poll |

## Environment Variables

| Variable | Purpose | Source |
|----------|---------|--------|
| `PORT` | Server port | `.env` |
| `DATABASE_URL` | PostgreSQL connection string | `.env` |
| `KAFKA_BROKERS` | Kafka broker addresses | `.env` |
| `KAFKA_GROUP_ID` | Consumer group ID | `.env` |
| `KAFKA_TOPICS` | Topic glob pattern | `.env` |
| `RESEND_API_KEY` | Resend email API key (global fallback) | `.env` |
| `RESEND_FROM` | Sender email address (global fallback) | `.env` |
| `API_KEYS` | Comma-separated valid API keys (legacy fallback) | `.env` |
| `ADMIN_API_KEY` | Admin key for `/api/admin/*` endpoints | `.env` |
| `DEDUP_WINDOW_MINUTES` | Deduplication time window | `.env` |
| `DIGEST_SCHEDULE` | Digest frequency (hourly/daily) | `.env` |
| `QUIET_HOURS_CHECK_INTERVAL_MS` | Quiet hour release check interval | `.env` |
| `NOTIFICATION_RETENTION_DAYS` | Days before notification cleanup | `.env` |
| `KINGSLEY_RESEND_KEY` | (Optional) Resend API key for personal tenant | `.env.local` |
| `KINGSLEY_RESEND_FROM` | (Optional) Sender email for personal tenant | `.env.local` |
| `KINGSLEY_TELEGRAM_BOT_TOKEN` | (Optional) Telegram bot token for personal tenant | `.env.local` |
| `KINGSLEY_TELEGRAM_BOT_USERNAME` | (Optional) Telegram bot username for personal tenant | `.env.local` |
| `KINGSLEY_EMAIL` | (Optional) Personal email for receiving notifications | `.env.local` |

## Commands

| Action | Command |
|--------|---------|
| Dev server | `npm run dev` |
| Run tests | `npx vitest run` |
| Run tests (unit only) | `N/A` (no test:unit script — YOLO falls back to full and flags `no_test_tier_split`) |
| Run tests (integration only) | `npx vitest run` (no separate integration tier — duplicates full) |
| Run tests (watch) | `npx vitest` |
| Lint/check | `npx tsc --noEmit` |
| Build | `npm run build` |
| Migrate DB | `npx drizzle-kit migrate` |
| Seed DB | `npm run db:seed` |
| Create topics | `npm run topics:create` |
| E2E tests | `N/A` (no `test:e2e` script yet — Phase 0 should add one if endpoints exist) |
| Start infra | `docker compose up -d` |
| Stop infra | `docker compose down` |
| Check infra | `docker compose ps` |
| Setup personal tenant | `npm run setup:personal` |

## Key Patterns & Conventions

> **Patterns live in `.agent/knowledge/patterns/` — one file per pattern.** See `patterns/_index.md` for the catalog. Do NOT add a flat bullet list here — it's a banned append-only pattern. See `CODING_STANDARDS.md` — "Append-Only Knowledge Files Banned."

## Gotchas & Lessons Learned

> **Gotchas live in `.agent/knowledge/gotchas/` — one file per gotcha.** See `gotchas/_index.md` for the catalog. `yolo-subagent-implement` writes new gotcha files during Step 9.3; never append to a flat table here. See `CODING_STANDARDS.md` — "Append-Only Knowledge Files Banned."

## Shared Foundation (MUST READ before any implementation)

> **Foundation primitives live in `.agent/knowledge/foundation/` — one file per primitive.** See `foundation/_index.md` for the catalog. The AI MUST read the relevant files **in full** before writing any new code that touches the surface they establish. Do NOT add a flat table here — it's a banned append-only pattern.

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
