// Phase 7 H9 — Multi-language template variants.
//
// The pipeline's template lookup needs to:
//   1. Read `event.payload.locale` (default 'en' if absent).
//   2. Try (tenant_id, name, locale) — if found, render that variant.
//   3. On miss, fall back to (tenant_id, name, 'en'). If found, render that.
//   4. On second miss, mark notification failed with a clear error message
//      naming the template name + requested locale.
//
// The rule has a single `template_id` FK, so to look up by NAME we resolve
// the name from the rule's referenced template, then look up siblings sharing
// the same name across locales. This file's tests assert the end-to-end
// behavior; the implementation lives in `src/processor/pipeline.ts`.
//
// Multi-tenant: tests include a second tenant (Tenant B) with its own de variant
// to assert Tenant A's de lookup never returns Tenant B's row.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import {
  createTestTenant, createTestTemplate, createTestRule, cleanupTestData,
} from '../test/factories.js';
import { notifications } from '../db/schema.js';
import { processNotification } from './pipeline.js';

let tenantA: Awaited<ReturnType<typeof createTestTenant>>;
let tenantB: Awaited<ReturnType<typeof createTestTenant>>;

beforeAll(async () => {
  tenantA = await createTestTenant(db);
  tenantB = await createTestTenant(db);
});

afterAll(async () => {
  await cleanupTestData(db, tenantA.id);
  await cleanupTestData(db, tenantB.id);
  await sql.end();
});

function makeEvent(
  tenantId: string,
  overrides: Partial<{ event_id: string; event_type: string; payload: Record<string, unknown> }> = {},
) {
  return {
    tenant_id: tenantId,
    event_type: overrides.event_type ?? 'order.completed',
    event_id: overrides.event_id ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    payload: overrides.payload ?? { name: 'Alice', orderId: '999' },
    timestamp: new Date().toISOString(),
  };
}

describe('processNotification — locale resolution (Phase 7 H9)', () => {
  it('resolves locale-specific variant when both en and de exist', async () => {
    const baseName = `welcome-${Date.now()}-1`;
    const enTmpl = await createTestTemplate(db, tenantA.id, {
      name: baseName,
      locale: 'en',
      subject: 'Welcome {{name}}',
      body: 'Hello {{name}}, welcome aboard.',
    });
    const deTmpl = await createTestTemplate(db, tenantA.id, {
      name: baseName,
      locale: 'de',
      subject: 'Willkommen {{name}}',
      body: 'Hallo {{name}}, willkommen an Bord.',
    });
    // Rule references the en variant by id; pipeline must resolve siblings by name.
    const rule = await createTestRule(db, tenantA.id, enTmpl.id, {
      eventType: `order.completed.${baseName}`,
      channel: 'email',
      recipientType: 'static',
      recipientValue: 'a@example.com',
    });

    const event = makeEvent(tenantA.id, {
      event_type: rule.eventType,
      payload: { name: 'Alice', orderId: '1', locale: 'de' },
    });

    await processNotification(db, event, rule, 'a@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
    });

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif).toBeDefined();
    expect(notif.subject).toBe('Willkommen Alice');
    expect(notif.bodyPreview).toContain('Hallo Alice');
    // Cross-tenant / cross-locale leak guard
    expect(notif.subject).not.toContain('Welcome');
    expect(notif.bodyPreview).not.toContain('Hello Alice');

    // unused — keep TS happy
    void deTmpl;
  });

  it('falls back to en variant when locale-specific variant is missing', async () => {
    const baseName = `welcome-${Date.now()}-2`;
    const enTmpl = await createTestTemplate(db, tenantA.id, {
      name: baseName,
      locale: 'en',
      subject: 'Welcome {{name}}',
      body: 'Hello {{name}}.',
    });
    const rule = await createTestRule(db, tenantA.id, enTmpl.id, {
      eventType: `order.completed.${baseName}`,
      channel: 'email',
      recipientType: 'static',
      recipientValue: 'b@example.com',
    });

    const event = makeEvent(tenantA.id, {
      event_type: rule.eventType,
      payload: { name: 'Bob', locale: 'fr' },
    });

    await processNotification(db, event, rule, 'b@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
    });

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif).toBeDefined();
    expect(notif.subject).toBe('Welcome Bob');
    expect(notif.bodyPreview).toContain('Hello Bob');
    expect(notif.status).toBe('sent');
  });

  it('fails notification when neither requested locale nor en exists', async () => {
    const baseName = `welcome-${Date.now()}-3`;
    // Only a 'de' variant — no 'en' fallback exists.
    const deTmpl = await createTestTemplate(db, tenantA.id, {
      name: baseName,
      locale: 'de',
      subject: 'Willkommen',
      body: 'Hallo.',
    });
    const rule = await createTestRule(db, tenantA.id, deTmpl.id, {
      eventType: `order.completed.${baseName}`,
      channel: 'email',
      recipientType: 'static',
      recipientValue: 'c@example.com',
    });

    const event = makeEvent(tenantA.id, {
      event_type: rule.eventType,
      payload: { name: 'Carol', locale: 'fr' },
    });

    await processNotification(db, event, rule, 'c@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
    });

    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif).toBeDefined();
    expect(notif.status).toBe('failed');
    expect(notif.errorMessage).toContain(baseName);
    expect(notif.errorMessage).toContain('fr');
    expect(notif.errorMessage).toContain('no en fallback');
  });

  it('integration — de variant rendered verbatim end-to-end (subject + body)', async () => {
    // Mock the dispatcher to capture the rendered subject + body that the
    // pipeline pushes to the channel layer. This proves the locale variant
    // was actually selected (not just stored in bodyPreview).
    const dispatcherModule = await import('../channels/dispatcher.js');
    const dispatchSpy = vi
      .spyOn(dispatcherModule, 'dispatch')
      .mockResolvedValue({ success: true });

    const baseName = `intl-${Date.now()}`;
    const enTmpl = await createTestTemplate(db, tenantA.id, {
      name: baseName,
      locale: 'en',
      subject: 'Order {{orderId}} confirmed',
      body: 'Hi {{name}}, your order {{orderId}} is confirmed.',
    });
    await createTestTemplate(db, tenantA.id, {
      name: baseName,
      locale: 'de',
      subject: 'Bestellung {{orderId}} bestätigt',
      body: 'Hallo {{name}}, deine Bestellung {{orderId}} ist bestätigt.',
    });
    // Tenant B has a de variant for the same name to prove tenant isolation.
    await createTestTemplate(db, tenantB.id, {
      name: baseName,
      locale: 'de',
      subject: 'TENANT-B-LEAK-SUBJECT',
      body: 'TENANT-B-LEAK-BODY',
    });

    const rule = await createTestRule(db, tenantA.id, enTmpl.id, {
      eventType: `order.completed.${baseName}`,
      channel: 'email',
      recipientType: 'static',
      recipientValue: 'intl@example.com',
    });

    const event = makeEvent(tenantA.id, {
      event_type: rule.eventType,
      payload: { name: 'Dora', orderId: 'A42', locale: 'de' },
    });

    await processNotification(db, event, rule, 'intl@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
    });

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const callArgs = dispatchSpy.mock.calls[0];
    // dispatch(channel, address, subject, body, ctx, cfg)
    const subject = callArgs[2];
    const body = callArgs[3];
    expect(subject).toBe('Bestellung A42 bestätigt');
    expect(body).toBe('Hallo Dora, deine Bestellung A42 ist bestätigt.');
    // Tenant isolation guard
    expect(subject).not.toContain('TENANT-B-LEAK');
    expect(body).not.toContain('TENANT-B-LEAK');

    vi.restoreAllMocks();
  });
});
