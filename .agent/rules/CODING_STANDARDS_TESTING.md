# Event-Driven Notification Hub — Coding Standards: Testing (Core TDD)

> Part 3 of 6. Also loaded: `CODING_STANDARDS.md`, `CODING_STANDARDS_META.md`, `CODING_STANDARDS_TESTING_LIVE.md`, `CODING_STANDARDS_TESTING_E2E.md`, `CODING_STANDARDS_DOMAIN.md`
> This file covers core TDD discipline. For mock policy and integration → `CODING_STANDARDS_TESTING_LIVE.md`. For E2E over real HTTP → `CODING_STANDARDS_TESTING_E2E.md`.

## Testing Rules — Anti-Cheat (CRITICAL)

### Never Do These
- **NEVER modify a test to make it pass.** Fix the IMPLEMENTATION, not the test.
- **NEVER use empty test bodies.**
- **NEVER hardcode return values** just to satisfy a test.
- **NEVER hardcode tenant-identity literals in templates/emails** just to make a template test pass. If `{{recipient.X}}` or `{{tenant.Y}}` doesn't resolve, extend the schema or escalate — never inline the literal. See `CODING_STANDARDS.md` — "No Silent Workarounds" and `CODING_STANDARDS_DOMAIN.md` — "Multi-Tenant Config-Driven Surfaces."
- **NEVER use broad exception handlers** to swallow errors that would make tests fail.
- **NEVER mock the thing being tested.** Only mock external dependencies.
- **NEVER skip or mark tests as expected failures** without explicit user approval.
- **NEVER weaken a test assertion** to make it pass.
- **NEVER delete a failing test.** Failing tests are bugs. Fix them.
- **NEVER run template/email tests against only one tenant fixture.** Single-tenant fixtures mask cross-tenant leakage. See "Multi-Tenant Fixtures Mandatory" below.

### TDD Sequence is Non-Negotiable
- Tests FIRST, then implementation. Never the reverse.
- You MUST create test files BEFORE creating implementation files.
- You MUST run tests and see RED (failures) before writing any implementation.
- You MUST show the RED PHASE EVIDENCE output (as defined in `implement-next-guide.md` Step 5) before proceeding to Green Phase.
- The ONLY exception: `[SETUP]` items (scaffolding, config, infrastructure) where no testable behavior exists yet.
- If you catch yourself implementing without tests — STOP, delete the implementation, write the tests first.

### Always Do These
- **Test BEHAVIOR, not implementation.**
- **Test edge cases:** empty inputs, null, zero, negative, missing, duplicate.
- **Test sad paths:** API errors, timeouts, invalid data.
- **Assertions must be specific:** `expect(result).toEqual(expected)`, not `expect(result).toBeDefined()`.

## Test Quality Checklist (Anti-False-Confidence)

Before moving from RED → GREEN, verify ALL applicable categories have tests:

| # | Category | What to Test |
|---|----------|-------------|
| 1 | Happy path | Does it work with valid, normal input? |
| 2 | Required fields | Does it reject null/blank for required fields? |
| 3 | Uniqueness | Does it enforce unique constraints? |
| 4 | Defaults | Do default values apply correctly when field is omitted? |
| 5 | FK relationships | Do foreign keys enforce CASCADE correctly? |
| 6 | Tenant isolation | Can Tenant A see Tenant B's data? (MANDATORY — this project is multi-tenant; includes templates, emails, notification rendering) |
| 7 | Edge cases | Empty strings, zero, negative, very long strings, special chars |
| 8 | Error paths | What happens when external APIs (Resend, Telegram) fail, DB is down, input is malformed? |
| 9 | Status enums | Are notification statuses (pending/sent/failed/queued_digest/skipped/held) validated? |
| 10 | Indexes / constraints | Are unique constraints (template name per tenant, etc.) and FK CASCADE working? |

**If a category applies and you skip it, you're cheating.** If RED phase shows fewer than 2 failures, add more tests — you're probably not testing enough.

### Performance Awareness
- Correctness tests alone don't catch latency regressions — an endpoint can pass all tests while making 10× the necessary DB calls
- When a single endpoint triggers 3+ DB queries, consider asserting query count or response time
- After every batch of 5+ features, do a compound load check: hit real endpoints and verify total I/O matches expectations

### Multi-Tenant Fixtures Mandatory (CRITICAL — Catches Cross-Tenant Leakage)

This project is multi-tenant — every data-bearing table has `tenant_id` (PRD Architecture Principles). Every test suite that touches tenant-scoped data MUST load **at least TWO distinct tenants** with different literal values.

**Why:** A Handlebars template that hardcodes "Acme Corp" passes every test when the fixture only loads Acme. It fails the moment Globex onboards. Two-tenant fixtures expose this at RED phase, not in production.

**Rules:**

1. **Test factories (`src/test/factories.ts`) MUST support creating ≥2 tenants** with intentionally-different identity values (different api_keys, names, emails, telegram bot tokens). Tests that touch templates, emails, or admin/event publishing MUST exercise both.
2. **Template / email / digest tests MUST parametrize over both tenants** (Vitest `describe.each` / `test.each`) and assert that rendering Tenant A's payload does NOT include any Tenant B literal value and vice versa.
3. **Cross-tenant leakage grep (runs in suite):** Add a test that reads the rendered output and greps for EVERY literal identity value of the OTHER tenant. Any match fails the test with a `TENANT_IDENTITY_LEAK` message.
4. **Tenant isolation test per module:** Category 6 in the Test Quality Checklist above is MANDATORY for every module that queries the DB (rules, templates, preferences, notifications, digest, heartbeats). Every query, every API response, every job run must be asserted to respect `tenant_id` scoping.

**This rule is non-optional for config-driven surfaces** (Handlebars templates, Resend email bodies, Telegram message text). Skipping it means cross-tenant leakage when a second tenant onboards.

## Edge Case Coverage Guide

### Schema/Models
- Every Drizzle column from the spec → at least 1 test per constraint
- Every FK → test CASCADE behavior
- Every status enum → test all valid values + 1 invalid value (Zod rejects)

### Services (when applicable)
- Boundary values (min, max, zero, negative)
- Invalid input types
- Idempotency (running twice = same result — esp. for dedup, digest send)
- Mock external API failures (Resend 503, Telegram timeout)

### API Routes (Fastify)
- Missing/invalid `X-API-Key` → 401/403
- Missing/invalid `X-Admin-Key` on `/api/admin/*` → 401/403
- Correct HTTP methods per route
- Response format validation (`{ error: { code, message, details } }`)
- Tenant scoping (Tenant A cannot see Tenant B's rules/templates/preferences/notifications)

## Test Modularity Rules
1. **One test file per module** — never mix modules in one file
2. **Max 300 lines per test file** — split if larger
3. **`beforeEach` creates only what that suite needs** — no global fixtures
4. **Tests are independent** — no shared state, no ordering dependency
5. **Any single test can run in isolation** — `npx vitest run path/to/file.test.ts -t "test name"`
6. **Test names describe business behavior** — not technical actions
7. **No test helpers longer than 10 lines** — extract to `src/test/factories.ts` if needed

## Business-Context Testing
- Tests must reflect the BUSINESS PURPOSE described in the spec.
- Every test must answer: Does this protect tenant data? Apply notification rules correctly? Handle channel failures? Match the spec?
- Test names must describe business behavior ("rejects email when user opted out of marketing"), not technical actions ("returns false from `shouldSend`").

> **Integration, Mock Policy, E2E rules** → see `CODING_STANDARDS_TESTING_LIVE.md` and `CODING_STANDARDS_TESTING_E2E.md`.
