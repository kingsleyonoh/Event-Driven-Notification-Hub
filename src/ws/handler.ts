import fp from 'fastify-plugin';
import websocket from '@fastify/websocket';
import type { WebSocket, RawData } from 'ws';
import { eq } from 'drizzle-orm';
import { tenants, notifications } from '../db/schema.js';
import { createLogger } from '../lib/logger.js';
import type { Database } from '../db/client.js';

const logger = createLogger('ws');

// Connection store: "tenantId:userId" → Set of active sockets
const connections = new Map<string, Set<WebSocket>>();

function getKey(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

export function pushToUser(tenantId: string, userId: string, payload: object): boolean {
  const key = getKey(tenantId, userId);
  const sockets = connections.get(key);
  if (!sockets || sockets.size === 0) return false;

  const message = JSON.stringify({ type: 'notification', notification: payload });
  let sent = false;
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
      sent = true;
    }
  }
  return sent;
}

export function getConnectionCount(): number {
  let count = 0;
  for (const sockets of connections.values()) {
    count += sockets.size;
  }
  return count;
}

async function handleMessage(
  raw: RawData,
  db: Database,
  userId: string,
): Promise<void> {
  try {
    const msg = JSON.parse(raw.toString());

    if (msg.type === 'acknowledge' && msg.notification_id) {
      await db
        .update(notifications)
        .set({ deliveredAt: new Date() })
        .where(eq(notifications.id, msg.notification_id));

      logger.info({ notificationId: msg.notification_id, userId }, 'notification acknowledged');
    }
  } catch (err) {
    logger.warn({ err, userId }, 'invalid WebSocket message');
  }
}

interface WsPluginOptions {
  db: Database;
}

export const wsPlugin = fp<WsPluginOptions>(async (app, opts) => {
  const { db } = opts;

  await app.register(websocket);

  // Non-async handler — register listeners synchronously to avoid missing events
  app.get('/ws/notifications', { websocket: true }, (socket, request) => {
    const query = request.query as Record<string, string>;
    const userId = query.userId;
    const tenantId = query.tenantId;

    // Validate required params (sync — closes immediately)
    if (!userId || !tenantId) {
      socket.close(4400, 'Missing userId or tenantId');
      return;
    }

    const key = getKey(tenantId, userId);
    let validated = false;
    const messageQueue: RawData[] = [];

    // Register listeners synchronously so no messages are missed
    socket.on('message', (raw) => {
      if (validated) {
        handleMessage(raw, db, userId);
      } else {
        messageQueue.push(raw);
      }
    });

    socket.on('close', () => {
      const sockets = connections.get(key);
      if (sockets) {
        sockets.delete(socket);
        if (sockets.size === 0) {
          connections.delete(key);
        }
      }
      logger.info({ tenantId, userId, connections: getConnectionCount() }, 'client disconnected');
    });

    // Async tenant validation — fire and forget
    void (async () => {
      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      if (!tenant || !tenant.enabled) {
        socket.close(4401, 'Invalid or disabled tenant');
        return;
      }

      // Register connection
      if (!connections.has(key)) {
        connections.set(key, new Set());
      }
      connections.get(key)!.add(socket);
      validated = true;

      // Process any queued messages
      for (const msg of messageQueue) {
        await handleMessage(msg, db, userId);
      }
      messageQueue.length = 0;

      // Signal client that connection is validated and ready
      socket.send(JSON.stringify({ type: 'connected', tenantId, userId }));
      logger.info({ tenantId, userId, connections: getConnectionCount() }, 'client connected');
    })();
  });
});
