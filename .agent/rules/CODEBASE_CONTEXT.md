# Event-Driven Notification Hub — Codebase Context

> Last updated: 2026-03-22
> Template synced: 2026-03-22

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
│   │   └── router.ts               # Event → rule matching
│   ├── processor/
│   │   ├── pipeline.ts              # Preference checks, dedup, digest routing
│   │   ├── deduplicator.ts
│   │   └── preferences.ts          # User preference evaluation
│   ├── channels/
│   │   ├── email.ts                 # Resend integration
│   │   ├── sms.ts                   # SMS stub
│   │   └── in-app.ts               # WebSocket push
│   ├── templates/
│   │   └── renderer.ts             # Handlebars rendering
│   ├── digest/
│   │   └── engine.ts               # Digest batching + sending
│   ├── api/
│   │   ├── rules.routes.ts
│   │   ├── templates.routes.ts
│   │   ├── preferences.routes.ts
│   │   ├── notifications.routes.ts
│   │   ├── health.routes.ts
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
| Consumer | Kafka event ingestion + rule matching | `src/consumer/kafka.ts`, `src/consumer/router.ts` |
| Processor | Notification pipeline (opt-out, quiet hours, dedup, digest) | `src/processor/pipeline.ts` |
| Channels | Multi-channel delivery (email, SMS, in-app) | `src/channels/email.ts`, `sms.ts`, `in-app.ts` |
| Templates | Handlebars template compilation + rendering | `src/templates/renderer.ts` |
| Digest | Batch notification aggregation + scheduled sending | `src/digest/engine.ts` |
| API | REST endpoints for rules, templates, preferences, notifications | `src/api/*.routes.ts` |
| WebSocket | Real-time push notifications to connected clients | `src/ws/handler.ts` |
| DB | Drizzle ORM schema, migrations, client | `src/db/schema.ts`, `client.ts` |

## Database Schema

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `notification_rules` | Event → channel routing rules | `event_type`, `channel`, `template_id`, `recipient_type`, `urgency` |
| `templates` | Handlebars message templates per channel | `name` (unique), `channel`, `subject`, `body` |
| `user_preferences` | Per-user delivery settings | `user_id` (unique), `opt_out` (JSONB), `quiet_hours` (JSONB), `digest_mode` |
| `notifications` | Delivery log with status tracking | `event_id`, `recipient`, `channel`, `status`, `skip_reason` |
| `digest_queue` | Pending digest items for batch sending | `user_id`, `notification_id`, `scheduled_for`, `sent` |

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
| `API_KEYS` | Comma-separated valid API keys | `.env` |
| `DEDUP_WINDOW_MINUTES` | Deduplication time window | `.env` |
| `DIGEST_SCHEDULE` | Digest frequency (hourly/daily) | `.env` |

## Commands

| Action | Command |
|--------|---------|
| Dev server | `npm run dev` |
| Run tests | `npx vitest run` |
| Run tests (watch) | `npx vitest` |
| Lint/check | `npx tsc --noEmit` |
| Build | `npm run build` |
| Migrate DB | `npx drizzle-kit migrate` |
| Create topics | `npm run topics:create` |
| Docker (dev) | `docker compose up -d` |

## Key Patterns & Conventions

- File naming: `kebab-case.ts` for modules, `camelCase` for variables/functions
- Error handling: centralized `{ error: { code, message, details } }` format
- Auth: API key in `X-API-Key` header, validated by middleware
- Pagination: cursor-based on notification listings
- Import order: std → third-party → local, blank line between groups

## Gotchas & Lessons Learned

> Discovered during implementation. Added automatically by `/implement-next` Step 9.3.

| Date | Area | Gotcha | Discovered In |
|------|------|--------|---------------|
| | | | |

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
| Auth middleware | `src/api/middleware/` | API key validation guard |

## Deep References

> For detailed implementation patterns, read the source directly.

| Topic | Where to look |
|-------|--------------|
| Kafka consumer | `src/consumer/` |
| Notification pipeline | `src/processor/` |
| Channel handlers | `src/channels/` |
| Template rendering | `src/templates/` |
| Digest engine | `src/digest/` |
| REST API routes | `src/api/` |
| WebSocket | `src/ws/` |
| Database | `src/db/` |
| Test patterns | `tests/` |
