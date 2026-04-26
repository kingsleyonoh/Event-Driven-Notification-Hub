# Per-Tenant Channel Config Resolution

## Purpose

Each tenant carries its own channel credentials (Resend API key, Telegram bot token, sender addresses) in the `tenants.config` JSONB column. Channel handlers must resolve these per-request without leaking another tenant's keys.

## When to use

- Any channel handler (email, telegram, sms, in-app) sending on behalf of a tenant.

## How it works

- `resolveTenantChannelConfig(tenant, channel)` in `src/lib/channel-config.ts` is the canonical resolver.
- Reads `tenant.config.channels[channel]` (e.g. `tenant.config.channels.email = { resendKey, from, replyTo }`).
- Falls back to env-var globals (`RESEND_API_KEY`, `RESEND_FROM`) when a tenant doesn't override.
- Returns a `DispatchConfig` for the dispatcher to pass to the channel handler — handlers never see raw `tenants.config`.
- For the personal tenant, `KINGSLEY_*` env vars (Resend key, Telegram token, etc.) are loaded by `src/scripts/setup-personal.ts` and stored in `tenants.config`.

## Cross-references

- Foundation: `.agent/knowledge/foundation/lib-channel-config.md`
- Foundation: `.agent/knowledge/foundation/channels-dispatcher.md`
