import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import {
  tenants,
  templates,
  notificationRules,
  userPreferences,
} from '../db/schema.js';
import { setupPersonalTenant } from './setup-personal.js';

const TENANT_ID = 'kingsley';

async function cleanupPersonalData() {
  await db.delete(notificationRules).where(eq(notificationRules.tenantId, TENANT_ID));
  await db.delete(templates).where(eq(templates.tenantId, TENANT_ID));
  await db.delete(userPreferences).where(eq(userPreferences.tenantId, TENANT_ID));
  await db.delete(tenants).where(eq(tenants.id, TENANT_ID));
}

const validEnv = {
  KINGSLEY_RESEND_KEY: 're_test_123',
  KINGSLEY_RESEND_FROM: 'test@kingsleyonoh.com',
  KINGSLEY_TELEGRAM_BOT_TOKEN: '123456:ABC-DEF',
  KINGSLEY_TELEGRAM_BOT_USERNAME: 'TestBot',
  KINGSLEY_EMAIL: 'kingsley@example.com',
};

beforeAll(async () => {
  await cleanupPersonalData();
});

afterAll(async () => {
  await cleanupPersonalData();
  await sql.end();
});

describe('setupPersonalTenant', () => {
  it('creates the kingsley tenant with channel config', async () => {
    const result = await setupPersonalTenant(db, validEnv);

    expect(result.tenantId).toBe(TENANT_ID);
    expect(result.apiKey).toBeTruthy();
    expect(result.rulesCreated).toBeGreaterThanOrEqual(5);
    expect(result.templatesCreated).toBeGreaterThanOrEqual(6);
    expect(result.preferencesCreated).toBe(1);

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, TENANT_ID));
    expect(tenant).toBeDefined();
    expect(tenant.name).toBe('Kingsley Personal');
    expect(tenant.config).toMatchObject({
      channels: {
        email: { apiKey: 're_test_123', from: 'test@kingsleyonoh.com' },
        telegram: { botToken: '123456:ABC-DEF', botUsername: 'TestBot' },
      },
    });
  });

  it('creates all expected templates', async () => {
    const tpls = await db
      .select()
      .from(templates)
      .where(eq(templates.tenantId, TENANT_ID));

    const names = tpls.map((t) => t.name);
    expect(names).toContain('task-assigned-email');
    expect(names).toContain('task-assigned-telegram');
    expect(names).toContain('deploy-completed-telegram');
    expect(names).toContain('alert-triggered-email');
    expect(names).toContain('alert-triggered-telegram');
    expect(names).toContain('__digest');
  });

  it('creates rules mapping event types to channels', async () => {
    const rules = await db
      .select()
      .from(notificationRules)
      .where(eq(notificationRules.tenantId, TENANT_ID));

    const pairs = rules.map((r) => `${r.eventType}:${r.channel}`);
    expect(pairs).toContain('task.assigned:email');
    expect(pairs).toContain('task.assigned:telegram');
    expect(pairs).toContain('deploy.completed:telegram');
    expect(pairs).toContain('alert.triggered:email');
    expect(pairs).toContain('alert.triggered:telegram');
  });

  it('creates user preferences with the provided email', async () => {
    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.tenantId, TENANT_ID));

    expect(prefs).toBeDefined();
    expect(prefs.userId).toBe('kingsley');
    expect(prefs.email).toBe('kingsley@example.com');
    expect(prefs.digestMode).toBe(false);
  });

  it('is idempotent — running twice does not error or duplicate', async () => {
    const result2 = await setupPersonalTenant(db, validEnv);
    expect(result2.tenantId).toBe(TENANT_ID);
    expect(result2.apiKey).toBeTruthy();

    // Should still have exactly the expected counts (not doubled)
    const tpls = await db
      .select()
      .from(templates)
      .where(eq(templates.tenantId, TENANT_ID));
    expect(tpls.length).toBe(6);

    const rules = await db
      .select()
      .from(notificationRules)
      .where(eq(notificationRules.tenantId, TENANT_ID));
    expect(rules.length).toBe(5);

    const prefs = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.tenantId, TENANT_ID));
    expect(prefs.length).toBe(1);
  });
});
