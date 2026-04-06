# Event-Driven Notification Hub — Coding Standards: Live Testing

> Part 3 of 4. Also loaded: `CODING_STANDARDS.md`, `CODING_STANDARDS_TESTING.md`, `CODING_STANDARDS_DOMAIN.md`

## Live Integration Testing (Mock Policy)

### The Rule: Don't Mock What You Own
If you control the service and can run it locally → test against the real thing.

### Service Fallback Hierarchy
When deciding how to test a service, follow this order:
1. **Local instance** (best) — Docker, CLI, emulator on your machine
2. **Cloud dev instance** (good) — dedicated test project / staging environment
3. **Mock** (last resort) — only when options 1 and 2 are impossible

### Test LIVE (Never Mock)
- Your database (local PostgreSQL via Docker) — validates schema, column names, constraints, query behavior
- Your own API endpoints — call the actual route, not a stub
- Your own server actions / business logic — test the real function
- Kafka/Redpanda (local via Docker) — validates event consumption, topic routing, message serialization

### Mock ONLY These
- Third-party payment APIs (Stripe charges money)
- Email delivery (Resend sends emails — mock in tests)
- Rate-limited external APIs you don't control
- Services with irreversible side effects
- Cloud-only services with no local emulator AND no dev tier

### Common Mock Violations (DO NOT DO THESE)
- ❌ Mocking your database client to return fake rows — hit the real database
- ❌ Mocking your own API routes with `nock`/`msw` — call the real endpoint via Fastify `inject()`
- ❌ Using an in-memory SQLite when production uses PostgreSQL — use the real PostgreSQL
- ❌ Mocking Redpanda/Kafka when it's running in Docker — connect to the real instance
- ✅ Mocking Resend API — you don't want to send real emails in tests
- ✅ Mocking an external API with rate limits — you don't control their uptime

### No Services? No Problem
If the project has no external services (CLI tool, library, static site), this policy doesn't apply — just write standard unit tests.

### Why This Matters
A mock that returns `{ user_id: 1 }` will pass even when the real column is `userId`. A mock that returns success will pass even when the real constraint rejects your data. Mocks test your ASSUMPTIONS about the service. Live tests test REALITY.

### Test Cleanup
- Each test MUST clean up after itself (delete rows, reset state)
- Use transactions with rollback when possible for speed

## Backend API & Integration Testing

> This section applies to backend-only projects (APIs, workers, event consumers). If the project has a frontend, see the Component Testing section in the template instead.

### When to Write Integration Tests
- Every **API endpoint**: POST/GET/PUT/DELETE routes on Fastify
- Every **Kafka consumer handler**: event ingestion, dedup, routing
- Every **service with database interaction**: CRUD operations, queries, constraints
- **Not required for**: pure utility functions (test with unit tests instead)

### What to Test
| Priority | Test This | Example |
|----------|-----------|---------|
| 1 | Request/Response cycle | POST /rules → 201 + rule body; GET /rules → list |
| 2 | Validation & error handling | Missing required field → 400; invalid type → 422 |
| 3 | Database side effects | POST /rules → row exists in DB; DELETE → row gone |
| 4 | Event processing | Kafka message → notification created in DB |
| 5 | Authentication/Authorization | Missing API key → 401; invalid key → 403 |

### What NOT to Test
- **Implementation details** — don't assert on internal function calls; test the output
- **Snapshot tests** — test behavior, not serialized output
- **Third-party API internals** — mock Resend, test your code around it

### File Naming & Location
- Name: `module.test.ts` — co-located next to the module file
- Example: `src/api/rules.test.ts`
- Group test utilities in `src/test/helpers.ts` if shared across tests

### Minimum Coverage Rule
Every API route MUST have at least:
- **1 happy-path test** (valid request → correct response)
- **1 error/edge-case test** (invalid input, missing auth, duplicate entry)
- If a route has 0 tests → it's a regression waiting to happen

### Setup (Vitest)
- `vitest` as test runner
- Fastify `inject()` for HTTP request simulation (no real server needed)
- Use test database with transactions rolled back per test
- Configure in `vitest.config.ts`
