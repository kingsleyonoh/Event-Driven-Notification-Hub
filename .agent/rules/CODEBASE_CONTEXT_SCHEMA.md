# Event-Driven Notification Hub — Database Schema

> Companion to `CODEBASE_CONTEXT.md`. Schema reference for all Drizzle table definitions.

## Database Schema

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `tenants` | Tenant registry with API keys and per-tenant config | `id` (TEXT PK), `name`, `api_key` (UNIQUE), `config` (JSONB — channel credentials, etc.), `enabled` |
| `notification_rules` | Event → channel routing rules (per tenant) | `tenant_id` (FK), `event_type`, `channel` (`email`/`sms`/`in_app`/`telegram`), `template_id` (FK), `recipient_type`, `recipient_field`, `urgency` |
| `templates` | Handlebars message templates per channel (per tenant) | `tenant_id` (FK), `name` (unique per tenant), `channel`, `subject`, `body` |
| `user_preferences` | Per-user delivery settings (per tenant) | `tenant_id` (FK), `user_id` (unique per tenant), `email`, `phone`, `telegram_chat_id`, `telegram_link_token`, `opt_out` (JSONB), `quiet_hours` (JSONB), `digest_mode` |
| `notifications` | Delivery log with status tracking | `tenant_id` (FK), `event_id`, `recipient`, `channel`, `payload` (JSONB), `status` (`pending`/`sent`/`failed`/`queued_digest`/`skipped`/`held`), `skip_reason`, `created_at`, `sent_at` |
| `digest_queue` | Pending digest items for batch sending | `tenant_id` (FK), `user_id`, `notification_id` (FK), `scheduled_for`, `sent` |
| `heartbeats` | Liveness monitoring for external systems | `tenant_id` (FK), `source_name`, `interval_minutes`, `last_seen_at`, `alerted_at`, `enabled` |

## Multi-Tenant Invariant

Every data-bearing table has `tenant_id` (FK to `tenants.id`). Every query MUST scope by `tenantId` (resolved from the `X-API-Key` header via `authMiddleware`). Cross-tenant reads/writes are an architecture violation.

The `tenants.config` JSONB is the per-tenant channel credentials store — `resolveTenantChannelConfig()` in `src/lib/channel-config.ts` is the canonical resolver. NEVER read tenant config inline in route handlers; always go through the resolver.

## Status Enums

- **`notifications.status`:** `pending` (created, awaiting dispatch) → `sent` (delivered) | `failed` (channel error) | `queued_digest` (deferred to digest batch) | `skipped` (opt-out / quiet-hours / dedup) | `held` (in quiet-hours, will release later)
- **`notification_rules.channel`:** `email` | `sms` | `in_app` | `telegram`
- **`templates.channel`:** matches `notification_rules.channel`
- **`user_preferences.digest_mode`:** `immediate` | `hourly` | `daily`

## Indexes & Constraints

- `tenants.api_key` UNIQUE
- `templates(tenant_id, name)` UNIQUE — template names are unique per-tenant, not globally
- `user_preferences(tenant_id, user_id)` UNIQUE
- `notifications(tenant_id, event_id, recipient, channel)` for dedup window queries
- All FKs use `ON DELETE CASCADE` so deleting a tenant cleanly removes all child rows

## Migrations

Drizzle migrations live in `src/db/migrations/`. Generate via `npx drizzle-kit generate`, apply via `npx drizzle-kit migrate`. On Windows, `drizzle-kit migrate` may hang — fall back to running the migration SQL via `docker exec psql` (see gotcha file).
