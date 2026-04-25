# Event-Driven Notification Hub — Coding Standards: Domain & Production

> Part 6 of 6. Also loaded: `CODING_STANDARDS.md`, `CODING_STANDARDS_META.md`, `CODING_STANDARDS_TESTING.md`, `CODING_STANDARDS_TESTING_LIVE.md`, `CODING_STANDARDS_TESTING_E2E.md`

## Architecture: Module Dependency Hierarchy (PRD Architecture Principles, default §2)
```
lib/ → nothing
db/ → lib/
templates/ → lib/
channels/ → lib/, templates/
consumer/ → db/, lib/
processor/ → db/, lib/, channels/, templates/
digest/ → db/, lib/, channels/, templates/
ws/ → lib/
heartbeat/ → db/, lib/, consumer/
api/ → db/, processor/, consumer/, lib/, heartbeat/
server.ts → api/, ws/, consumer/, db/, config
```
- **NEVER import upward** in this hierarchy (e.g., `db/` must never import from `processor/`)
- `lib/` is the foundation — shared types, utilities, errors, channel-config resolver
- New modules must declare their position in this hierarchy before implementation

## Deployment Flow (Dev → Production)

### Dev Branch Workflow
1. All implementation work happens on `dev` branch
2. Tests run against local services (PostgreSQL + Redpanda via Docker)
3. Each completed item → commit → push to `dev`
4. Run full test suite frequently: `npx vitest run`

### When Ready to Deploy
1. Ensure ALL tests pass on `dev`
2. Merge `dev` → `main`
3. Push `main` → triggers GHCR build + Hetzner VPS deploy via Traefik
4. Run migrations against production database
5. Verify deployment via `/api/health` (BetterStack monitors this)

### Emergency Hotfix Flow
- Branch from `main` → `hotfix/description`
- Fix + test → merge to BOTH `main` and `dev`
- Use `/hotfix` workflow for guidance

## Security Rules

### Secrets Management
- **NEVER hardcode secrets** — no API keys, passwords, tokens in source code OR deployment config files
- **`docker-compose.prod.yml` is git-tracked** — use `${VAR}` references, NEVER inline passwords. Create `.env` on the VPS for secrets.
- Use `.env` and `.env.local` files locally (BOTH listed in `.gitignore`)
- Use environment variables in production (set on Hetzner VPS)
- If you accidentally commit a secret, **rotate it immediately** — secrets in git history are compromised even after deletion. Pay special attention to `RESEND_API_KEY`, `KINGSLEY_RESEND_KEY`, `KINGSLEY_TELEGRAM_BOT_TOKEN`, `ADMIN_API_KEY`, and `tenants.api_key` rows.

### Input Validation
- Validate ALL user input at the boundary (Fastify route handler) using Zod v4 schemas in `src/api/schemas.ts`
- Never trust client-side validation alone
- Reject unknown fields where appropriate to prevent property pollution

### Authentication & Authorization
- Verify auth on EVERY protected endpoint via `authMiddleware` (`X-API-Key` → tenant lookup)
- Admin endpoints (`/api/admin/*`) require `X-Admin-Key` (env var `ADMIN_API_KEY`)
- Log auth failures (without logging the key value)
- Tenant scoping is enforced via `request.tenantId` injection — every query MUST include `where(eq(table.tenantId, request.tenantId))`

### SQL & Data Safety
- Use Drizzle ORM methods — NEVER string concatenation for SQL
- Sanitize user-supplied template content (Handlebars escapes by default — keep `noEscape: false`)
- Validate file upload sizes (when applicable)

### Multi-Tenant Config-Driven Surfaces (CRITICAL — Prevents Cross-Tenant Leakage)

This project is multi-tenant — `tenants.config` JSONB carries per-tenant Resend keys, Telegram bot tokens, etc. (`resolveTenantChannelConfig()` in `src/lib/channel-config.ts`). These surfaces MUST NEVER contain hardcoded per-tenant literals: Handlebars templates (`templates.body`, `templates.subject`), Resend From addresses outside `tenants.config`, Telegram bot tokens hardcoded into handlers.

**Banned:** legal entity names / addresses / contact info as constants in templates, Telegram bot tokens hardcoded in `channels/telegram*.ts`, single-tenant logo paths in template bodies.

**Required pattern — Template Context API:** Every notification renders against an **immutable snapshot** captured at delivery time (not a live tenant lookup — digest re-sends MUST use the original snapshot). Extend `tenants.config` schema BEFORE writing a `{{tenant.X}}` token. Use Handlebars `strict: true` so missing tokens throw, not silently emit `""`.

**Test contract:** Tests MUST load ≥2 tenants and assert Tenant A's render excludes any Tenant B literal (see `CODING_STANDARDS_TESTING.md` — Multi-Tenant Fixtures Mandatory). `validate-prd` and `security-audit` grep `templates.body` for tenant literals — matches = `TENANT_IDENTITY_LEAK`.

**If you hit a missing field:** apply "No Silent Workarounds" (`CODING_STANDARDS.md`). Escalate for schema extension. Do not hardcode.

## Environment Variables
- `.env` for local development (NEVER committed)
- `.env.local` for personal-tenant overrides (NEVER committed — `KINGSLEY_*` vars)
- `.env.example` for documenting required vars (committed, no real values)
- Production variables set on Hetzner VPS via env vars
- NEVER log env var values

## Production-Readiness Rules (Before Merge to Main)

Before merging ANY feature to `main`:

1. **All tests pass** — `npx vitest run` shows 0 failures
2. **No console.log debugging** — use structured Pino logging
3. **No TODO/FIXME/HACK** — resolve them or create tickets in `progress.md`
4. **Error handling exists** — every route has either `await app.handle()` or explicit try/catch routing to `AppError` subclasses
5. **Types are complete** — no `any` types in new TypeScript code
6. **Migrations are committed** — all Drizzle schema changes have migration files in `src/db/migrations/`
7. **Environment variables documented** — new ones added to `.env.example`
8. **Linting passes** — `npx tsc --noEmit` returns 0

## Code Organization Conventions

### Import Order
1. Node standard library imports
2. Third-party package imports (fastify, drizzle-orm, kafkajs, resend, etc.)
3. Local/project imports (`./`, `../`)
4. Blank line between each group

### Naming Conventions
- **Files:** `kebab-case.ts` for modules, `module.test.ts` for tests
- **Classes:** `PascalCase` (e.g., `AppError`, `NotFoundError`)
- **Functions/Methods:** `camelCase`
- **Constants:** `UPPER_SNAKE_CASE`
- **Drizzle table objects:** `camelCase` (e.g., `notificationRules`, `userPreferences`)

### Project Structure
- Follow the structure in `CODEBASE_CONTEXT.md`
- New modules go in the documented location for that type (channel handler → `src/channels/`, etc.)
- If unsure where something belongs, check `CODEBASE_CONTEXT.md` or ask

## Logging Standards
- Use structured Pino logging (JSON format in production)
- Log levels: `debug` (dev only), `info` (normal events), `warn` (recoverable), `error` (failures), `fatal` (shutdown)
- Include context: `tenantId`, `eventId`, `notificationId`, module name (via Fastify request scope)
- NEVER log sensitive data (API keys, Telegram bot tokens, full email bodies, PII)

## Error Response Standards
- Consistent error format across all endpoints: `{ error: { code, message, details } }`
- Use `AppError` subclasses + `toErrorResponse()` from `src/lib/errors.ts`
- Include error `code` (e.g., `RULE_NOT_FOUND`) — keep machine-readable
- Never leak stack traces to clients in production
- Log full error details server-side with Pino

## Server-Side Performance Rules

- **Deduplicate expensive calls.** Auth, tenant config, channel-config resolver — extract to a shared/request-scoped helper. Don't let each function fetch independently.
- **Parallel by default.** Independent DB queries / config resolves MUST run via `Promise.all`. Sequential is only for data-dependent chains.
- **Wire It or Delete It (ENFORCED).** New route → register in `server.ts`. New middleware → add to Fastify chain. New Kafka handler → register with `consumer.run`. New scheduler job → wire to `src/jobs/scheduler.ts`. New channel → wire into `src/channels/dispatcher.ts`. All in the SAME commit. Dead code with passing tests is still dead code.
- **Compound Load Audit.** After 5+ chained operations from a single endpoint (publish → match → preferences → dedup → digest → dispatch), audit total I/O.
- **Prefer joins over multiple queries.** Drizzle supports `with` clauses — use them. N separate queries is a sequential waterfall.

## Code Structure Rules

### Thin Entry Points
Fastify route handlers and Kafka consumer handlers MUST stay thin — validate input via Zod, call a service/domain function, format the response. Extract business logic, side effects (Resend send, Telegram send, DB writes), and data access into a separate layer (`src/processor/pipeline.ts`, `src/channels/*`, etc.).

### Single State Mechanism Per Feature
Multi-step flows (digest queueing → batch send → status update) must use ONE state mechanism. The notification's `status` enum (`pending` / `sent` / `failed` / `queued_digest` / `skipped` / `held`) is canonical — don't add parallel boolean flags.

### Modularity Awareness
Before adding code to any file, assess its current structure. Files should have a single clear responsibility. Project limits (300 lines/file, 50 lines/function, 200 lines/class from `/check-modularity`) are guardrails.
