import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import { createTestTenant, createTestTemplate, createTestRule, createTestNotification, cleanupTestData } from '../test/factories.js';
import { notifications } from '../db/schema.js';
import { buildApp } from '../server.js';
import { pushToUser } from './handler.js';

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let app: Awaited<ReturnType<typeof buildApp>>['app'];
let port: number;

beforeAll(async () => {
  tenant = await createTestTenant(db);

  const built = await buildApp({ db });
  app = built.app;
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  port = Number(new URL(address).port);
});

afterAll(async () => {
  await app.close();
  await cleanupTestData(db, tenant.id);
  await sql!.end();
});

function connectWs(params: Record<string, string>): Promise<WebSocket> {
  const qs = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/notifications?${qs}`);
    ws.on('error', reject);
    ws.on('message', function onReady(data) {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'connected') {
        ws.removeListener('message', onReady);
        resolve(ws);
      }
    });
  });
}

/** Connect and collect ALL messages from the start (persistent listener). */
function connectWsCollecting(params: Record<string, string>): {
  ws: WebSocket;
  messages: unknown[];
  ready: Promise<void>;
} {
  const qs = new URLSearchParams(params).toString();
  const messages: unknown[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/notifications?${qs}`);
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));

  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for connected')), 3000);
    const check = setInterval(() => {
      if (messages.some((m: any) => m.type === 'connected')) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 20);
  });

  return { ws, messages, ready };
}

function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
    ws.on('message', (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function waitForClose(ws: WebSocket, timeoutMs = 2000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for close')), timeoutMs);
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

function closeAndWait(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.on('close', () => resolve());
    ws.close();
  });
}

describe('WebSocket Connection Manager', () => {
  it('rejects connection with missing userId', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/notifications?tenantId=${tenant.id}`);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4400);
  });

  it('rejects connection with missing tenantId', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/notifications?userId=user-1`);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4400);
  });

  it('rejects connection with invalid tenantId', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/notifications?userId=user-1&tenantId=nonexistent`);
    const { code } = await waitForClose(ws);
    expect(code).toBe(4401);
  });

  it('accepts valid connection and cleans up on close', async () => {
    const ws = await connectWs({ userId: 'cleanup-user', tenantId: tenant.id });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    await closeAndWait(ws);
  });

  it('acknowledge message updates delivered_at in DB', async () => {
    const template = await createTestTemplate(db, tenant.id);
    const rule = await createTestRule(db, tenant.id, template.id);

    const notif = await createTestNotification(db, {
      tenantId: tenant.id,
      ruleId: rule.id,
      eventType: 'test.event',
      eventId: `ws-ack-${Date.now()}`,
      recipient: 'ack-user-2',
      channel: 'in_app',
      status: 'sent',
    });

    const ws = await connectWs({ userId: 'ack-user-2', tenantId: tenant.id });

    ws.send(JSON.stringify({ type: 'acknowledge', notification_id: notif.id }));

    // Poll for the DB update (max 2s)
    let deliveredAt: Date | null = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const [row] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, notif.id));
      if (row.deliveredAt) {
        deliveredAt = row.deliveredAt;
        break;
      }
    }

    expect(deliveredAt).toBeInstanceOf(Date);
    await closeAndWait(ws);
  });
});

describe('WebSocket Push', () => {
  it('pushToUser delivers message to connected client', async () => {
    const ws = await connectWs({ userId: 'push-test', tenantId: tenant.id });
    const msgPromise = waitForMessage(ws);
    const pushed = pushToUser(tenant.id, 'push-test', { test: true });
    expect(pushed).toBe(true);
    const msg = await msgPromise;
    expect(msg).toMatchObject({ type: 'notification', notification: { test: true } });
    await closeAndWait(ws);
  });
});

describe('WebSocket Tenant Isolation', () => {
  it('tenant A messages do not reach tenant B connections', async () => {
    const tenantB = await createTestTenant(db);

    // Use persistent message collectors to avoid listener-gap race conditions
    const a = connectWsCollecting({ userId: 'iso-user', tenantId: tenant.id });
    const b = connectWsCollecting({ userId: 'iso-user', tenantId: tenantB.id });
    await Promise.all([a.ready, b.ready]);

    const pushed = pushToUser(tenant.id, 'iso-user', {
      id: 'notif-iso-1',
      tenant_id: tenant.id,
      event_type: 'test.event',
      channel: 'in_app',
      subject: 'For Tenant A',
      body_preview: 'Body',
      created_at: new Date().toISOString(),
    });
    expect(pushed).toBe(true);

    // Allow time for message to arrive via TCP
    await new Promise((r) => setTimeout(r, 200));

    // Tenant A should receive the push notification
    const notifA = a.messages.find((m: any) => m.type === 'notification');
    expect(notifA).toMatchObject({
      type: 'notification',
      notification: { id: 'notif-iso-1', tenant_id: tenant.id },
    });

    // Tenant B should NOT receive any notification
    const notifB = b.messages.find((m: any) => m.type === 'notification');
    expect(notifB).toBeUndefined();

    await closeAndWait(a.ws);
    await closeAndWait(b.ws);
    await cleanupTestData(db, tenantB.id);
  });
});
