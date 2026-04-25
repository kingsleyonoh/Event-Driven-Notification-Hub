# Event-Driven Notification Hub — Coding Standards: E2E Testing (Real Endpoints)

> Part 5 of 6. Also loaded: `CODING_STANDARDS.md`, `CODING_STANDARDS_META.md`, `CODING_STANDARDS_TESTING.md`, `CODING_STANDARDS_TESTING_LIVE.md`, `CODING_STANDARDS_DOMAIN.md`
> This file covers end-to-end testing that hits a running Fastify server via real HTTP. In-process testing (`app.inject()`) lives in `CODING_STANDARDS_TESTING_LIVE.md`.

## E2E Testing (Real Endpoints)

> E2E tests hit a RUNNING server over HTTP — not in-process `app.inject()`.
> The point is testing the deployed stack: Fastify startup, plugin registration order, real Postgres + Redpanda connections, response serialization.
> These catch issues that integration tests miss: port binding, plugin order, connection pool behavior under load, real Kafka consumer round-trips.

### When E2E is Required
- **Any batch that creates or modifies a Fastify route** → E2E MUST hit the running server
- **Any batch that creates or modifies a Kafka consumer handler** → E2E MUST publish a real event and wait for the notification to land
- **Pure utility/library/config batches with no endpoints** → E2E not required (skip with note)
- **`[SETUP]` items** → E2E not required unless the setup itself starts a server

### E2E Test Architecture

**Backend E2E (this project's surface):**
1. Start the actual server: `npm run dev` (NOT `app.inject()` in-process)
2. Wait for ready signal: poll `GET /api/health` until 200
3. Hit real endpoints via `fetch` (Node 22 has native fetch)
4. Assert on status codes, response bodies, headers
5. Stop the server after tests complete

**Real services required** (Docker PostgreSQL + Redpanda) — this aligns with the mock policy in `CODING_STANDARDS_TESTING_LIVE.md` ("Don't Mock What You Own"). Resend / Telegram remain mocked at the channel-handler boundary.

### E2E Test File Structure
```
tests/e2e/
  api/                         ← Backend E2E tests
    health.e2e.test.ts
    rules.e2e.test.ts
    notifications.e2e.test.ts
    admin.e2e.test.ts
  consumer/
    kafka-event-flow.e2e.test.ts   ← Publish real Kafka event → assert DB notification
  helpers/
    server.ts                  ← Start/stop Fastify utilities
    seed.ts                    ← Test data seeding via Drizzle
```

### E2E vs Integration Tests
| Aspect | Integration (`app.inject()`) | E2E (running server) |
|--------|------------------------------|---------------------|
| Server | In-process, no real HTTP | Real HTTP, real port |
| Speed | Fast (~1ms per test) | Slower (~100ms+ per test) |
| What it catches | Handler logic, validation, DB | Plugin order, port binding, real Kafka round-trip |
| When to use | Every endpoint (RED/GREEN phase) | After REGRESSION passes |
| Run command | `npx vitest run` | `npm run test:e2e` (configure if missing) |

**Both are required.** Integration tests are your fast feedback loop (TDD). E2E tests are your deployment confidence check.

### E2E Test Cleanup
- Each E2E test must clean up its own data (delete created tenants/rules/notifications, reset state)
- Use a dedicated test tenant per test to avoid polluting dev data
- Kill the server process reliably in the `afterAll` hook — leaked processes block ports

### Bootstrap Setup for E2E
If `tests/e2e/` does not yet exist, add `[SETUP] E2E testing framework — PRD N/A` to Phase 0:
- Create `tests/e2e/` directory structure
- Add a fetch-based runner (no extra dep needed — Node 22 has fetch)
- Add `test:e2e` script to `package.json`
- Add Vitest config that runs e2e separately from integration
- Verify the E2E command runs and exits cleanly (even with 0 tests)

### Honesty Check for E2E Skips
**E2E skip reasons are a high-fabrication surface** — sub-agents have historically tried to claim "E2E covered by `app.inject()`" or "E2E deferred" to shortcut the running-server requirement. The canonical list of rejected skip patterns lives in `.agent/agents/yolo/yolo-honesty-checks.md` Section 2. When running a batch that touches Fastify routes or Kafka consumers, the ONLY valid skip reasons are:
- `SKIPPED_NO_ENDPOINTS` — the batch genuinely touched no routes / consumers (verify against `## Items Completed`)
- `E2E_NOT_CONFIGURED` — framework not installed yet; warning logged, not blocking

Any other skip reason (including "Docker required", "covered by `app.inject()`", or `DEFERRED`) is rejected by YOLO master's Phase 3.2b as `E2E_DISHONEST_SKIP`.
