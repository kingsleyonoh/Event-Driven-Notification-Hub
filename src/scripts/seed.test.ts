import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import { tenants, templates, notificationRules } from '../db/schema.js';
import { seed } from './seed.js';

beforeAll(async () => {
  // Clean up only seed-specific data (not other tests' data)
  await db.delete(notificationRules).where(eq(notificationRules.tenantId, 'default'));
  await db.delete(notificationRules).where(eq(notificationRules.tenantId, 'demo'));
  await db.delete(templates).where(eq(templates.tenantId, 'default'));
  await db.delete(templates).where(eq(templates.tenantId, 'demo'));
  await db.delete(tenants).where(eq(tenants.id, 'default'));
  await db.delete(tenants).where(eq(tenants.id, 'demo'));

  await seed(db);
});

afterAll(async () => {
  await db.delete(notificationRules).where(eq(notificationRules.tenantId, 'default'));
  await db.delete(notificationRules).where(eq(notificationRules.tenantId, 'demo'));
  await db.delete(templates).where(eq(templates.tenantId, 'default'));
  await db.delete(templates).where(eq(templates.tenantId, 'demo'));
  await db.delete(tenants).where(eq(tenants.id, 'default'));
  await db.delete(tenants).where(eq(tenants.id, 'demo'));
  await sql.end();
});

describe('seed script', () => {
  it('creates default and demo tenants', async () => {
    const result = await db.select().from(tenants);

    const ids = result.map((t) => t.id);
    expect(ids).toContain('default');
    expect(ids).toContain('demo');
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('assigns unique API keys to each tenant', async () => {
    const result = await db.select().from(tenants);
    const keys = result.map((t) => t.apiKey);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it('creates __digest email template for each tenant', async () => {
    const digestTemplates = await db
      .select()
      .from(templates)
      .where(eq(templates.name, '__digest'));

    expect(digestTemplates.length).toBeGreaterThanOrEqual(2);
    for (const t of digestTemplates) {
      expect(t.channel).toBe('email');
      expect(t.body).toBeTruthy();
    }
  });

  it('creates demo event rules for demo tenant', async () => {
    const demoRules = await db
      .select()
      .from(notificationRules)
      .where(eq(notificationRules.tenantId, 'demo'));

    expect(demoRules.length).toBeGreaterThanOrEqual(4);

    const eventTypes = demoRules.map((r) => r.eventType);
    expect(eventTypes).toContain('task.assigned');
    expect(eventTypes).toContain('comment.added');
    expect(eventTypes).toContain('build.completed');
    expect(eventTypes).toContain('deploy.started');
  });

  it('creates templates for demo rules', async () => {
    const demoTemplates = await db
      .select()
      .from(templates)
      .where(eq(templates.tenantId, 'demo'));

    // At least __digest + templates for the 4 demo rules
    expect(demoTemplates.length).toBeGreaterThanOrEqual(5);
  });
});
