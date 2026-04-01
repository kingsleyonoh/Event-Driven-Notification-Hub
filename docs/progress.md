# Event-Driven Notification Hub — Progress Tracker

## Phase 0: Project Foundation

### Dev Environment Setup
- [x] [SETUP] Git branching strategy (completed during bootstrap Step 2b)
  - `main` = production deployments only, `dev` = active development
- [x] [SETUP] Prerequisite: Docker Desktop installed and running
  - Docker 27.5.1, Docker Compose v2.32.4
- [x] [SETUP] Environment configuration
  - Created `.env.local` with local service URLs
  - Updated `.env.example` with all PRD Section 14 vars
  - Configured `TEST_DATABASE_URL` pointing to local PostgreSQL
  - Configured `ADMIN_API_KEY` for admin endpoints
  - `.env.local` already in `.gitignore`
- [x] [SETUP] Define error response format (`{ error: { code, message, details } }` — Section 8b)
  - Implemented in `src/lib/errors.ts` — AppError base + 6 subclasses + toErrorResponse()
- [x] [SETUP] Define API key auth guard approach (`X-API-Key` header → tenant lookup)
  - Implemented in `src/api/middleware/auth.ts` — onRequest hook, DB lookup, inject tenant context
- [x] [SETUP] Define Fastify plugin structure
  - Plugin registration order in `server.ts`: error handler → rate limiter → admin auth → tenant auth
  - All middleware uses `fastify-plugin` (fp) pattern for encapsulation breaking
- [x] [SETUP] Define Drizzle ORM client setup pattern
  - Implemented in `src/db/client.ts` — createDb(url) returns {db, sql}
- [x] [SETUP] Document architecture patterns in `CODEBASE_CONTEXT.md`
  - Module dependency hierarchy, tenant middleware flow, error handling strategy, plugin registration order

### Docker Compose (Section 3, 11)
- [x] Create `docker-compose.yml` with Redpanda + PostgreSQL 16 services
- [x] Verify Redpanda starts and accepts connections on `localhost:19092`
  - Fixed: external Kafka listener is on port 19092 (not 9092). Removed host mapping of internal 9092 port.
- [x] Verify PostgreSQL starts and accepts connections on configured port

### Testing Infrastructure
- [x] [SETUP] Testing infrastructure
  - [x] Install Vitest + Supertest
  - [x] Create `vitest.config.ts`
  - [x] Configure test runner to use local PostgreSQL from `.env.local`
  - [x] Create test directory structure matching `src/` layout
  - [x] Add test scripts to `package.json` (`test`, `test:watch`, `test:coverage`)
  - [x] Configure coverage threshold (≥ 80% — Section 15)
  - [x] Write one smoke test hitting the local database to verify connectivity
  - [x] Confirm: `npm test` runs green against local PostgreSQL (28 tests, 3 test files)
- [/] [SETUP] Create test helpers / factories / mocks (`src/test/`)
  - [x] Tenant factory (create test tenants with API keys)
  - [x] Rule factory (create test notification rules)
  - [x] Template factory (create test templates)
  - [ ] Kafka producer mock (publish test events) — deferred to consumer phase
  - [ ] Resend API mock (mock email delivery) — deferred to channel phase
  - [x] Shared test setup/teardown utilities (cleanupTestData)

---

## Phase 1: Infrastructure (Section 13 — Day 1)

### TypeScript + Fastify Setup (Section 3)
- [x] Create `tsconfig.json` with TypeScript 5.x strict mode
- [x] Initialize Fastify 5.x server (`src/server.ts`)
- [x] Create `src/config.ts` — environment variable loader with validation (Section 14)
  - [x] **Test:** unit test for config parsing (valid, missing, invalid env vars, bad format e.g. non-numeric port)
  - [x] **Test:** config startup rejection — server refuses to start with missing required env vars (e.g. `DATABASE_URL`, `KAFKA_BROKERS`)
- [x] Create `src/lib/logger.ts` — Pino structured JSON logger configuration
- [x] Create `src/lib/errors.ts` — custom error classes (VALIDATION_ERROR, NOT_FOUND, CONFLICT, etc.)
  - [x] **Test:** unit test for each error class (correct code, message, HTTP status mapping)
- [x] Create `drizzle.config.ts` — Drizzle-kit migration configuration
- [x] Add `dev` and `build` scripts to `package.json` (Section 11 step 7)

### Database Schema + Migrations (Section 4)
- [x] Set up Drizzle ORM with PostgreSQL driver (`src/db/client.ts`)
- [x] Create `tenants` table (Section 4.6)
- [x] Create `notification_rules` table (Section 4.1) — with indexes + unique constraint
- [x] Create `templates` table (Section 4.2) — with unique (tenant_id, name)
- [x] Create `user_preferences` table (Section 4.3) — with unique (tenant_id, user_id)
- [x] Create `notifications` table (Section 4.4) — with 3 indexes (dedup, status, recipient)
- [x] Create `digest_queue` table (Section 4.5) — with 2 indexes
- [x] Create `heartbeats` table (Section 4.7) — with unique + index
- [x] Run initial migration: applied via psql (drizzle-kit migrate has driver issue on Windows)
- [x] Add `npm run db:migrate` script to `package.json`
- [x] Create seed script for default tenant (`default`) and demo tenant (`demo`) with sample rules, templates, `__digest` email template per tenant, and demo event rules (`task.assigned`, `comment.added`, `build.completed`, `deploy.started` — Section 2b)
  - `__digest` template convention: reserved name for digest batching, `channel = 'email'`
  - [x] **Test:** seed data verification — assert seed script creates expected tenants, rules, templates (including `__digest`) — 5 tests

### Kafka Topic Creation (Section 5.1, 11)
- [x] Create topic creation script (`npm run topics:create`)
- [x] Configure topic pattern `events.*`
- [x] Verify topics exist after creation

### Input Validation Layer
- [x] Set up shared validation schemas (Zod or TypeBox) for request body validation across all endpoints
  - Created `src/api/schemas.ts` with Zod v4 schemas for rules, templates, preferences, events, admin tenants, pagination

### Auth + Tenant Middleware (Section 8b)
- [x] Implement API key auth middleware (`X-API-Key` header → lookup in `tenants` table)
  - [x] **Test:** unit test for auth middleware (valid key, invalid key, missing key, disabled tenant)
- [x] Implement tenant context middleware (resolves `tenant_id` from API key, injects into request context)
  - [x] **Test:** unit test for tenant context injection (combined with auth middleware tests)
- [x] Implement global error handler middleware (`src/api/middleware/error-handler.ts` — standard `{ error: { code, message, details } }` format)
  - [x] **Test:** unit test for error handler (each error code + format, 7 tests)
- [x] Implement per-endpoint rate limiter middleware (`src/api/middleware/rate-limiter.ts`)
  - [x] **Test:** unit test for rate limiter (under limit, over limit → 429, rate limit headers)
- [x] Implement admin auth middleware (`X-Admin-Key` header → validate against `ADMIN_API_KEY` env var)
  - [x] **Test:** unit test for admin auth (valid key, invalid key, missing key)

### Health Endpoint (Section 8b, 10b)
- [x] `GET /api/health` — app status, PostgreSQL connectivity, Kafka broker reachability, Resend API status
  - [x] **Test:** integration test for health endpoint (all checks pass, degraded state) — 3 tests

---

## Phase 2: Event Processing + Rules/Templates API (Section 13 — Day 1-2)

### Rules Management API (Section 5.5, 8b)
- [x] `POST /api/rules` — create notification rule (event_type, channel, template_id, recipient_type, recipient_value, urgency)
- [x] `GET /api/rules` — list all notification rules (tenant-scoped)
- [x] `GET /api/rules/:id` — get single notification rule
- [x] `PUT /api/rules/:id` — update notification rule (partial fields)
- [x] `DELETE /api/rules/:id` — delete notification rule (204 No Content)

### Templates Management API (Section 5.5, 8b)
- [x] `POST /api/templates` — create template (name, channel, subject, body). Reject names prefixed with `__` (reserved for system templates like `__digest`)
- [x] `GET /api/templates` — list all templates (tenant-scoped)
- [x] `GET /api/templates/:id` — get single template
- [x] `PUT /api/templates/:id` — update template (partial fields)
- [x] `DELETE /api/templates/:id` — delete template (204 No Content, 409 if used by rule)
- [x] `POST /api/templates/:id/preview` — render template with sample payload and return `{ rendered_subject, rendered_body }`

### Kafka Consumer (Section 5.1)
- [x] Set up KafkaJS consumer subscribing to configurable topic pattern (`events.*`)
- [x] Implement Kafka event schema validation — reject malformed events with error log (missing fields, wrong types)
- [x] Deserialize messages: `{ tenant_id, event_type, event_id, payload, timestamp }`
- [x] Validate `tenant_id` exists and is enabled in `tenants` table — skip with log if invalid
- [x] Handle topic non-existence fallback — logs warning, will retry on reconnect
- [x] Configure KafkaJS auto-reconnect with exponential backoff (KafkaJS default)
  - [x] **Test:** unit test for schema validation (6 tests — missing fields, empty values, valid payload)
  - _Configuration handled by `src/config.ts`: `KAFKA_BROKERS`, `KAFKA_GROUP_ID`, `KAFKA_TOPICS`_

### Shared Kafka Producer (Section 5.1, 4.7)
- [x] Create `src/consumer/producer.ts` — shared KafkaJS producer utility (reused by test event publisher and heartbeat checker)
  - Shares KafkaJS client instance with consumer for connection efficiency

### Test Event Publisher (Section 8b)
- [x] `POST /api/events` — publish a test event to Kafka via shared producer (inject `tenant_id` from auth middleware into published event)
  - Rate limit: 10/min
  - [x] **Test:** integration test for event publishing (3 tests — publish, validation, auth)

### Event → Rule Matching (Section 5.1)
- [x] Query `notification_rules` by `tenant_id` + `event_type` where `enabled = true`
- [x] Resolve recipient from event payload based on `recipient_type`:
  - `event_field` → dot-path extraction from payload
  - `static` → use `recipient_value` directly
  - `role` → log warning "role-based routing not implemented", skip
  - [x] **Test:** unit test for recipient resolution (6 tests — event_field, nested, missing, static, role skip)

### Handlebars Template Rendering (Section 5.2, 5.3)
- [x] Create `src/templates/renderer.ts` — Handlebars compilation and rendering
- [x] Render subject (for email) + body using event payload as context
- [x] Handle missing template variables gracefully (renders empty string)
  - [x] **Test:** unit test for template rendering (valid payload, missing variables, empty payload, nested vars) — 6 tests

### Notification Processor Pipeline (Section 5.2)
- [x] Implement per-tenant config resolution — handled via config param passed from consumer
- [x] Resolve delivery address from recipient + channel + user preferences (5 tests)
- [x] Opt-out check (6 tests)
- [x] Quiet hours check with timezone support (7 tests)
- [x] Deduplication check against all statuses including held/queued_digest (6 tests)
- [x] Digest mode routing + digest_queue insertion
- [x] Extract `scheduled_for` calculation into `src/lib/scheduling.ts` (8 tests — hourly/daily/weekly)
- [x] Channel dispatch stub in `src/channels/dispatcher.ts` (3 tests)
- [x] Full pipeline orchestrator `processNotification` in `src/processor/pipeline.ts` (8 integration tests)

### Notification Logging (Section 4.4)
- [x] Insert `notifications` record for every processed event (sent, failed, skipped, queued_digest, held)
- [x] Store `body_preview` (first 500 chars of rendered body) — verified with truncation test

### Integration Tests (Section 13 Phase 2)
- [x] **Test:** integration tests for rules CRUD (11 tests — create, read, update, delete, validation, 404s, conflicts, auth)
- [x] **Test:** integration tests for templates CRUD (13 tests — create, read, update, delete, preview, __ reject, duplicate name)
- [x] **Test:** integration test — template deletion constraint (409 CONFLICT when used by rule)
- [ ] **Test:** integration test — event consumed → notification created with correct tenant_id
- [ ] **Test:** integration test — tenant isolation (tenant A event does not trigger tenant B rules)

---

## Phase 3: Channel Delivery (Section 13 — Day 2)

### Email Handler (Section 5.3)
- [x] `src/channels/email.ts` — Resend API integration
- [x] Send rendered subject + body to recipient email
- [x] Record delivery status (sent/failed) with error message on failure
  - [x] **Test:** unit test for email handler (mock Resend API — success, failure, rate limit, null subject) — 4 tests
  - _Configuration handled by `src/config.ts`: `RESEND_API_KEY`, `RESEND_FROM`_

### SMS Handler Stub (Section 5.3)
- [x] `src/channels/sms.ts` — stub implementation
- [x] Log SMS message and recipient via Pino
- [x] Record as "sent" (no actual delivery)
- [x] Placeholder for Twilio/Vonage integration
  - [x] **Test:** unit test for SMS stub (logs message, records status) — 2 tests

### WebSocket Connection Manager (Section 8b WebSocket)
- [ ] `src/ws/handler.ts` — Fastify WebSocket plugin setup
- [ ] Path: `/ws/notifications?userId={userId}&tenantId={tenantId}` (tenant-scoped connections)
- [ ] Enforce tenant isolation: connections scoped to `tenantId + userId` pairs
- [ ] Handle inbound: `{ type: "acknowledge", notification_id }` → mark as read
- [ ] Handle outbound: `{ type: "notification", notification }` → push on delivery
- [ ] Track active connections per `tenantId + userId`
  - [ ] **Test:** integration test — WebSocket push notification (connect, receive, acknowledge, assert latency < 200ms per Section 15)
  - [ ] **Test:** integration test — WebSocket tenant isolation (tenant A events don't reach tenant B connections)

### In-App WebSocket Handler (Section 5.3)
- [ ] `src/channels/in-app.ts` — WebSocket push to connected clients
- [ ] If recipient not connected → store as unread notification
- [ ] Mark as delivered when acknowledged by client
  - [ ] **Test:** unit test for in-app handler (push to connected client, store unread when disconnected, acknowledgment updates status)

### Delivery Status Tracking (Section 5.3)
- [x] Update `notifications.status` after each channel handler attempt
- [x] Record `delivered_at` timestamp on success
- [x] Record `error_message` on failure
  - [x] **Test:** unit test for delivery status updates (sent → delivered_at set, failed → error_message set) — 2 tests
  - Updated dispatcher to route email → `sendEmail()`, sms → `sendSms()`, in_app → stub
  - Updated dispatcher tests — 3 new routing tests (email config routing, sms routing, in_app stub fallback)

### Integration Tests (Section 13 Phase 3)
- [ ] **Test:** integration test — event → email sent via Resend (mocked)
- [ ] **Test:** integration test — WebSocket reconnect → client calls `GET /api/notifications/:userId/unread` to fetch missed notifications

---

## Phase 4: Preferences, Digest & Heartbeat (Section 13 — Day 2-3)

### User Preferences API (Section 5.5, 8b)
- [ ] `PUT /api/preferences/:userId` — create/update user preferences (opt-out, quiet hours, digest mode, contact info)
- [ ] `GET /api/preferences/:userId` — retrieve user preferences
- [ ] Validate opt-out JSONB structure: `{ "channel": ["category"] }`
- [ ] Validate quiet hours JSONB structure: `{ "start", "end", "timezone" }`
- [ ] Validate digest_schedule enum: `hourly`, `daily`, `weekly`

### Digest Queue (Section 4.5)
- [ ] Insert notifications into `digest_queue` when user has digest_mode enabled
- [ ] Set `scheduled_for` using shared calculation utility (hourly/daily/weekly)

### Digest Engine (Section 5.4)
- [ ] `src/digest/engine.ts` — scheduled batch processor
- [ ] Query `digest_queue` for items where `scheduled_for <= now()` and `sent = false`
- [ ] Group queued items by `tenant_id` + `user_id`
- [ ] For each notification: render individually using its rule's template + stored `payload` JSONB
- [ ] Look up tenant's `__digest` template (`templates WHERE tenant_id = ? AND name = '__digest'`)
  - If no `__digest` template → skip batch with warning log, mark entries as `sent = true`
- [ ] Compose rendered notifications into digest template context: `{ notifications, count, truncated, remaining_count }`
- [ ] Send one digest email per user via email handler
- [ ] Mark all digest_queue items as `sent = true`
- [ ] Truncate at 50 notifications per digest, note "and N more"
- [ ] Configuration: `DIGEST_SCHEDULE` (hourly/daily)
  - [ ] **Test:** unit test for digest engine (batch, render from stored payload, truncation, empty queue, missing `__digest` template)
  - [ ] **Test:** unit test for digest Handlebars template (renders notification list, handles truncation message)

### Notification Listing + Unread Count (Section 8b)
- [ ] `GET /api/notifications` — list notifications with cursor-based pagination (default 25, max 100)
  - Filters: `status`, `channel`, `created_after`, `created_before`, `userId`
- [ ] `GET /api/notifications/:userId/unread` — unread notification list + count

### Admin Tenant Management API (Section 8b)
- [ ] `POST /api/admin/tenants` — register new tenant (auto-generates API key, returns `{ tenant: { id, name, api_key, enabled } }`)
- [ ] `GET /api/admin/tenants` — list all tenants
- [ ] `GET /api/admin/tenants/:id` — get single tenant
- [ ] `PUT /api/admin/tenants/:id` — update tenant (name, config, enabled)
- [ ] `DELETE /api/admin/tenants/:id` — delete tenant (204 No Content)

### Heartbeat API (Section 8b, 4.7)
- [ ] Implement `POST /api/heartbeats` — register or pulse a heartbeat (upsert by `tenant_id` + `source_name`, update `last_seen_at` + clear `alerted_at`)
- [ ] Implement `GET /api/heartbeats` — list heartbeats for tenant
- [ ] Implement `DELETE /api/heartbeats/:id` — remove a heartbeat registration
- [ ] Implement `src/heartbeat/checker.ts` — find overdue heartbeats, publish synthetic `heartbeat.stale` events to Kafka via shared producer (`src/consumer/producer.ts`) — processed through normal rules engine
- [ ] **Test:** unit tests for heartbeat checker (stale detection, alert dedup via `alerted_at`, re-alert after new pulse)
- [ ] **Test:** integration tests for heartbeat API (register, pulse, list, delete, staleness flow)
- [ ] **Test:** integration test — heartbeat stale → rules engine → notification created (end-to-end)

### Integration Tests (Section 13 Phase 4)
- [ ] **Test:** integration tests for preferences API (create, update, read, validation)
- [ ] **Test:** integration tests for notifications listing (pagination, filters, unread count)
- [ ] **Test:** integration tests for admin tenant CRUD (create, read, update, delete, duplicate name, invalid admin key)
- [ ] **Test:** integration test — admin tenant creation auto-generates unique API key (verify key format + uniqueness on duplicate creation)
- [ ] **Test:** integration test for digest flow (queue → batch → email)

---

## Phase 5: Deploy (Section 13 — Day 3)

### Production Docker Setup (Section 10)
- [ ] `Dockerfile` — multi-stage build for TypeScript/Node.js
- [ ] `docker-compose.prod.yml` — Fastify app + Redpanda + PostgreSQL behind Traefik
- [ ] Domain: `notify.kingsleyonoh.com`
- [ ] Configure Traefik labels for TLS via Let's Encrypt

### Server Startup Wiring
- [ ] Wire all plugins, routes, middleware, and WebSocket in `src/server.ts`
- [ ] Implement graceful shutdown (SIGTERM/SIGINT → close Kafka consumer, disconnect Kafka producer, drain WebSocket connections, close DB pool)
  - [ ] **Test:** integration test for graceful shutdown (verify Kafka consumer stops, connections drain, DB pool closes)

### Background Jobs (Section 7)
- [ ] Implement digest sender interval in `server.ts` — configurable schedule (hourly/daily)
  - [ ] **Test:** unit test for digest sender scheduling (correct interval, timer cleanup on shutdown)
- [ ] Implement quiet hour release interval — every 15 minutes:
  - Query `notifications WHERE status = 'held'`
  - Check if quiet hours ended for each recipient's timezone (look up `user_preferences.quiet_hours`)
  - Re-render template from stored `payload` JSONB + `rule_id` → `template_id`
  - Dispatch to channel handler, update status `held → sent/failed`
  - Only operates on `held` records — never touches `queued_digest`
  - [ ] **Test:** unit test for quiet hour release (held notification released after window, idempotent re-run, skips still-in-quiet-hours)
  - [ ] **Test:** integration test for quiet hour hold-then-release flow (event during quiet hours → held → released when window ends, mocked time)
- [ ] Implement heartbeat checker interval — every 15 minutes (find stale heartbeats → publish `heartbeat.stale` events)
- [ ] Implement notification cleanup interval — daily at 03:00 UTC (delete records older than `NOTIFICATION_RETENTION_DAYS`)
  - [ ] **Test:** unit test for notification cleanup (deletes old records, preserves recent, respects retention days)

### Monitoring (Section 10b)
- [ ] Configure BetterStack uptime monitoring polling `/api/health`
- [ ] Log consumer lag at `warn` level when > 500 messages (Section 10b alerting rules)
- [ ] Log email delivery failure rate at `warn` level when > 20% in 1 hour (Section 10b alerting rules)

### [SCOPE?] Deployment region configuration
- [ ] Pin compute to same region as DB on Hetzner VPS (not explicitly in PRD — review if needed)

### End-to-End Verification
- [ ] Run `vitest run --coverage` and confirm ≥ 80% coverage
- [ ] Run end-to-end smoke test on production
- [ ] Deploy to Hetzner VPS via `docker compose -f docker-compose.prod.yml up -d`

---

## Success Criteria (Section 15)

- [ ] Kafka events are consumed and matched to notification rules correctly
- [ ] Tenant isolation: events for tenant A do not trigger rules or notifications for tenant B
- [ ] Handlebars templates render with event payload data
- [ ] Email delivery via Resend API succeeds with status tracking
- [ ] WebSocket push notifications reach connected clients in < 200ms
- [ ] User opt-outs prevent delivery on opted-out channels
- [ ] Quiet hours hold notifications until the window ends
- [ ] Deduplication prevents repeated notifications for the same event
- [ ] Digest mode batches notifications and sends a single email
- [ ] Heartbeat monitoring: stale heartbeats trigger notifications via existing rules engine
- [ ] All tests pass with > 80% coverage (`vitest run --coverage`)
- [ ] System deploys with `docker compose up`

---

## Future Work / Deferred to v2

> Items intentionally excluded from v1 scope. Revisit after core engine is deployed and connected to at least one client project.

- [ ] **Redis Pub/Sub for WebSockets** — Implement multi-instance state sync to prevent WebSocket split-brain across containers
- [ ] **Kafka Noisy Neighbor Protection** — Enforce pre-publish rate limits or multi-tenant topic isolation
- [ ] **Admin Dashboard** — Next.js admin panel with live notification feed (WebSocket), delivery stats, rule/template management, and tenant switching
- [ ] **Real SMS delivery** — Replace SMS stub with Twilio/Vonage integration in `src/channels/sms.ts`
- [ ] **Push notifications** — Firebase Cloud Messaging adapter for mobile push (`src/channels/push.ts`)
- [ ] **Retry mechanism** — Automatic retry with exponential backoff for failed deliveries
- [ ] **In-memory rule cache** — Cache notification rules with change invalidation to reduce DB queries
- [ ] **Per-tenant rate limiting** — Tenant-scoped quotas instead of global rate limits
- [ ] **Scheduled send** — "Send at 9 AM local time" support beyond digest batching
- [ ] **React notification center** — Embeddable `<NotificationCenter />` component for client frontends
- [ ] **Delivery analytics dashboard** — Sent/failed/skipped rates by channel, event type, and tenant
- [ ] **A/B testing** — Test different templates for the same rule and track engagement
- [ ] **Slack/Discord channels** — Webhook-based channel adapters
- [ ] **JWT WebSocket auth** — Replace query param auth with proper JWT validation
