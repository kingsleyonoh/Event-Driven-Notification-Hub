# Event-Driven Notification Hub — Coding Standards: Live & Integration Testing

> Part 4 of 6. Also loaded: `CODING_STANDARDS.md`, `CODING_STANDARDS_META.md`, `CODING_STANDARDS_TESTING.md`, `CODING_STANDARDS_TESTING_E2E.md`, `CODING_STANDARDS_DOMAIN.md`
> This file covers the mock policy and in-process backend integration testing. E2E testing over real HTTP lives in `CODING_STANDARDS_TESTING_E2E.md`.

## Live Integration Testing (Mock Policy)

### The Rule: Don't Mock What You Own
If you control the service and can run it locally → test against the real thing.

### Service Fallback Hierarchy
When deciding how to test a service, follow this order:
1. **Local instance** (best) — Docker, CLI, emulator on your machine
2. **Cloud dev instance** (good) — dedicated test project / staging environment
3. **Mock** (last resort) — only when options 1 and 2 are impossible

### Test LIVE (Never Mock)
- Your database (local PostgreSQL via Docker on port 5433) — validates schema, column names, constraints, query behavior
- Your own Fastify routes — call the actual route via `app.inject()`, not a stub
- Your own pipeline / processor / dispatcher logic — test the real function with a real DB
- Kafka/Redpanda (local via Docker, external listener on port 19092) — validates event consumption, topic routing, message serialization

### Mock ONLY These
- Resend API (real emails would actually send) — mock via `vi.mock('resend')` or factory injection
- Telegram Bot API (real messages would actually send) — mock the HTTP client
- BetterStack (uptime monitoring) — third-party service we don't control
- Rate-limited external APIs you don't control
- Services with irreversible side effects

### Common Mock Violations (DO NOT DO THESE)
- ❌ Mocking your Drizzle client to return fake rows — hit the real Postgres on port 5433
- ❌ Mocking your Fastify routes with `nock`/`msw` — call the real endpoint via `app.inject()`
- ❌ Using an in-memory SQLite when production uses PostgreSQL — use the real PostgreSQL
- ❌ Mocking Redpanda/Kafka when it's running in Docker — connect to the real instance on port 19092
- ✅ Mocking Resend — you don't want to send real emails in tests
- ✅ Mocking Telegram Bot API — you don't want to send real Telegram messages in tests
- ✅ Mocking an external API with rate limits — you don't control their uptime

### No Services? No Problem
If a module has no external services (pure utility, deduplicator, channel-config resolver), the policy doesn't apply — write standard unit tests with no mocks needed.

### Why This Matters
A mock that returns `{ user_id: 1 }` will pass even when the real Drizzle column is `userId`. A mock that returns success will pass even when the real Postgres unique constraint rejects the insert. Mocks test your ASSUMPTIONS about the service. Live tests test REALITY.

### Test Cleanup
- Each test MUST clean up after itself via `cleanupTestData(tenantId)` (deletes rows for that tenant)
- Use `beforeEach` to create fresh tenant + factories per test
- The shared test DB connection is in `src/test/setup.ts`

## Backend API & Integration Testing

> This is in-process integration testing — Fastify `inject()` instead of real HTTP. For real-HTTP testing over the network, see `CODING_STANDARDS_TESTING_E2E.md`.

### When to Write Integration Tests
- Every **API endpoint**: POST/GET/PUT/DELETE routes on Fastify (rules, templates, preferences, notifications, admin, events, heartbeats, health)
- Every **Kafka consumer handler**: event ingestion, dedup, routing
- Every **service with database interaction**: CRUD operations, queries, constraints
- Every **middleware**: auth (X-API-Key + X-Admin-Key), rate-limiter, error-handler
- **Not required for**: pure utility functions (test with unit tests instead)

### What to Test
| Priority | Test This | Example |
|----------|-----------|---------|
| 1 | Request/Response cycle | POST /rules → 201 + rule body; GET /rules → list scoped to tenant |
| 2 | Validation & error handling | Missing required field → 400; invalid type → 422; Zod errors mapped to `{ error: { code, message, details } }` |
| 3 | Database side effects | POST /rules → row exists in DB; DELETE → row gone |
| 4 | Event processing | Kafka message → notification created in DB; dedup window respected |
| 5 | Authentication/Authorization | Missing X-API-Key → 401; invalid key → 403; Tenant A cannot see Tenant B's rules |
| 6 | Admin endpoints | X-Admin-Key required for `/api/admin/*`; tenant CRUD works; rotates api_key correctly |

### What NOT to Test
- **Implementation details** — don't assert on internal function calls; test the output
- **Snapshot tests** — test behavior, not serialized output
- **Third-party API internals** — mock Resend / Telegram, test your code around it

### File Naming & Location
- Name: `module.test.ts` — co-located next to the module file
- Examples: `src/api/rules.test.ts`, `src/processor/pipeline.test.ts`, `src/channels/email.test.ts`
- Group test utilities in `src/test/factories.ts` and `src/test/setup.ts`

### Minimum Coverage Rule
Every API route MUST have at least:
- **1 happy-path test** (valid request → correct response)
- **1 error/edge-case test** (invalid input, missing auth, duplicate entry)
- **1 tenant-isolation test** (Tenant A's request can't see Tenant B's data)
- If a route has 0 tests → it's a regression waiting to happen

### Setup (Vitest)
- `vitest` as test runner (run via `npx vitest run`, watch via `npx vitest`)
- Fastify `app.inject()` for HTTP request simulation (no real server needed)
- Use shared test DB connection from `src/test/setup.ts`
- Per-test cleanup via `cleanupTestData(tenantId)` from `src/test/factories.ts`
- Configure in `vitest.config.ts`
