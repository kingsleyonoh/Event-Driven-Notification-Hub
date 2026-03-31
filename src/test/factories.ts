import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { tenants, templates, notificationRules } from '../db/schema.js';
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

export async function cleanupTestData(db: Database, tenantId: string) {
  await db.delete(notificationRules).where(eq(notificationRules.tenantId, tenantId));
  await db.delete(templates).where(eq(templates.tenantId, tenantId));
  await db.delete(tenants).where(eq(tenants.id, tenantId));
}
