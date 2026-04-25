# src/channels/

## Purpose

Multi-channel delivery handlers (email, SMS, in-app via WebSocket, Telegram) and the dispatcher that routes to them.

## Key files

- `src/channels/dispatcher.ts` — Routes a notification to the right channel handler with a `DispatchConfig` (resolved per-tenant via `resolveTenantChannelConfig()`).
- `src/channels/email.ts` — Resend integration. Mocked in tests.
- `src/channels/email-monitor.ts` — Sliding-window failure-rate tracker; alerts when email failures exceed threshold.
- `src/channels/sms.ts` — SMS stub (placeholder; PRD allows future provider).
- `src/channels/in-app.ts` — Pushes notifications via the WebSocket handler in `src/ws/`.
- `src/channels/telegram.ts` — Sends Telegram messages via Bot API per-tenant token.
- `src/channels/telegram-bot.ts` — Polling worker for `/start <link_token>` flow that links a Telegram chat to a `user_preferences.telegram_chat_id`.

## Dependencies

- Upstream: `src/lib/`, `src/templates/`, external HTTP (Resend, Telegram Bot API).
- Downstream: called by `src/processor/pipeline.ts`.

## Tests

- `src/channels/*.test.ts` — happy path + error paths for each channel; Resend / Telegram are mocked.

## Cross-references

- Pattern: `.agent/knowledge/patterns/007-tenant-channel-config.md`
- Foundation: `.agent/knowledge/foundation/channels-dispatcher.md`
