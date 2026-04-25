# Channel Dispatcher

## What it establishes

Single entry point that maps `channel` (email / sms / in_app / telegram) to the corresponding handler with a tenant-resolved `DispatchConfig`.

## Files

- `src/channels/dispatcher.ts` — `dispatch({ tenant, notification }) → Promise<DispatchResult>`. Internally calls `resolveTenantChannelConfig()` then routes.

## When to read this

Before adding a new channel. Before changing channel routing rules.

## Contract

- Adding a new channel = update the channel union type, add a handler under `src/channels/`, register it in the dispatcher's switch, add a config shape to `tenants.config.channels`.
- Handlers receive a `DispatchConfig` (resolved credentials), NEVER the raw `tenants.config`.
- Failures bubble up as `DispatchError` with channel-specific code.
