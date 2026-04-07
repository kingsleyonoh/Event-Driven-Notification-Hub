import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { tenants, templates, notificationRules, userPreferences, notifications, digestQueue } from '../db/schema.js';
import type { Database } from '../db/client.js';

export async function createTestTenant(
  db: Database,
  overrides: Partial<typeof tenants.$inferInsert> = {},
) {
  const id = overrides.id ?? `test-${crypto.randomBytes(6).toString('hex')}`;
  const [tenant] = await db
    .insert(tenants)
    .values({
      id,
      name: `Test Tenant ${id}`,
      apiKey: `test-key-${crypto.randomBytes(12).toString('hex')}`,
      ...overrides,
    })
    .returning();
  return tenant;
}

export async function createTestTemplate(
  db: Database,
  tenantId: string,
  overrides: Partial<typeof templates.$inferInsert> = {},
) {
  const [template] = await db
    .insert(templates)
    .values({
      tenantId,
      name: `test-template-${crypto.randomBytes(4).toString('hex')}`,
      channel: 'email',
      subject: 'Test Subject',
      body: 'Test body content',
      ...overrides,
    })
    .returning();
  return template;
}

export async function createTestRule(
  db: Database,
  tenantId: string,
  templateId: string,
  overrides: Partial<typeof notificationRules.$inferInsert> = {},
) {
  const [rule] = await db
    .insert(notificationRules)
    .values({
      tenantId,
      eventType: `test.event.${crypto.randomBytes(4).toString('hex')}`,
      channel: 'email',
      templateId,
      recipientType: 'static',
      recipientValue: 'test@example.com',
      ...overrides,
    })
    .returning();
  return rule;
}

export async function createTestPreferences(
  db: Database,
  tenantId: string,
  userId: string,
  overrides: Partial<typeof userPreferences.$inferInsert> = {},
) {
  const [prefs] = await db
    .insert(userPreferences)
    .values({
      tenantId,
      userId,
      ...overrides,
    })
    .returning();
  return prefs;
}

export async function createTestNotification(
  db: Database,
  overrides: Partial<typeof notifications.$inferInsert> & {
    tenantId: string;
    eventType: string;
    eventId: string;
    recipient: string;
    channel: 'email' | 'sms' | 'in_app' | 'telegram';
    status: 'pending' | 'sent' | 'failed' | 'queued_digest' | 'skipped' | 'held';
  },
) {
  const [notif] = await db
    .insert(notifications)
    .values(overrides)
    .returning();
  return notif;
}

export async function cleanupTestData(db: Database, tenantId: string) {
  await db.delete(digestQueue).where(eq(digestQueue.tenantId, tenantId));
  await db.delete(notifications).where(eq(notifications.tenantId, tenantId));
  await db.delete(notificationRules).where(eq(notificationRules.tenantId, tenantId));
  await db.delete(templates).where(eq(templates.tenantId, tenantId));
  await db.delete(userPreferences).where(eq(userPreferences.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
}
