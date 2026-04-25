# src/ws/

## Purpose

Real-time push notifications to connected clients via WebSocket.

## Key files

- `src/ws/handler.ts` — Fastify WebSocket plugin handler. On connect: reads `userId` query param + verifies via the same tenant API key (sent on the connect frame). Maintains an in-memory connection map keyed by `(tenantId, userId)`. The in-app channel handler in `src/channels/in-app.ts` looks up the connection and pushes the rendered notification.

## Dependencies

- Upstream: `@fastify/websocket`, `src/lib/`.
- Downstream: called by `src/channels/in-app.ts`.

## Tests

- `src/ws/handler.test.ts` — covers connect/disconnect lifecycle, push delivery, multi-tenant isolation.
