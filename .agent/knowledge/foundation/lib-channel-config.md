# Channel Config Resolver

## What it establishes

Per-tenant channel credential resolution from `tenants.config` JSONB → typed `DispatchConfig` for the dispatcher.

## Files

- `src/lib/channel-config.ts` — `resolveTenantChannelConfig(tenant, channel)` returns the per-channel config (Resend key + sender, Telegram bot token + username, etc.) with env-var fallbacks for the `RESEND_*` defaults.

## When to read this

Before any code reads `tenants.config` directly — STOP and route through this resolver. Before adding a new channel (you'll define a new key in `tenants.config.channels`).

## Contract

- Returns a frozen object — callers MUST NOT mutate.
- Falls back to env vars when the tenant-specific value is absent.
- Throws `ChannelConfigError` if a required credential is absent for both tenant and global fallback (don't silently send via a misconfigured channel).
