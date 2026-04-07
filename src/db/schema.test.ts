import { describe, it, expect, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { tenants, userPreferences } from './schema.js';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5433/notification_hub_test';

const { db, sql } = createDb(TEST_DB_URL);

afterAll(async () => {
  await sql.end();
});

describe('database connectivity', () => {
  it('connects to PostgreSQL and executes a query', async () => {
    const result = await db.execute<{ now: Date }>('SELECT NOW() as now');
    expect(result).toBeDefined();
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('tenants table', () => {
  const testTenantId = `test-${Date.now()}`;

  afterAll(async () => {
    await db.delete(tenants).where(eq(tenants.id, testTenantId));
  });

  it('inserts and reads back a tenant', async () => {
    await db.insert(tenants).values({
      id: testTenantId,
      name: 'Smoke Test Tenant',
      apiKey: `smoke-key-${Date.now()}`,
    });

    const [result] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, testTenantId));

    expect(result).toBeDefined();
    expect(result.name).toBe('Smoke Test Tenant');
    expect(result.enabled).toBe(true);
    expect(result.config).toEqual({});
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it('enforces unique api_key constraint', async () => {
    const sharedKey = `unique-key-${Date.now()}`;

    await db.insert(tenants).values({
      id: `${testTenantId}-dup1`,
      name: 'First',
      apiKey: sharedKey,
    });

    await expect(
      db.insert(tenants).values({
        id: `${testTenantId}-dup2`,
        name: 'Second',
        apiKey: sharedKey,
      }),
    ).rejects.toThrow();

    // Cleanup
    await db.delete(tenants).where(eq(tenants.id, `${testTenantId}-dup1`));
  });
});

describe('user_preferences — telegram columns', () => {
  const testTenantId = `test-tg-${Date.now()}`;

  afterAll(async () => {
    await db.delete(userPreferences).where(eq(userPreferences.tenantId, testTenantId));
    await db.delete(tenants).where(eq(tenants.id, testTenantId));
  });

  it('stores and reads telegram_chat_id and telegram_link_token', async () => {
    await db.insert(tenants).values({
      id: testTenantId,
      name: 'Telegram Test Tenant',
      apiKey: `tg-key-${Date.now()}`,
    });

    await db.insert(userPreferences).values({
      tenantId: testTenantId,
      userId: 'tg-user-1',
      telegramChatId: '123456789',
      telegramLinkToken: 'tok_abc123',
    });

    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, 'tg-user-1'));

    expect(prefs).toBeDefined();
    expect(prefs.telegramChatId).toBe('123456789');
    expect(prefs.telegramLinkToken).toBe('tok_abc123');
  });

  it('telegram columns are nullable — defaults to null', async () => {
    await db.insert(userPreferences).values({
      tenantId: testTenantId,
      userId: 'tg-user-2',
    });

    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, 'tg-user-2'));

    expect(prefs.telegramChatId).toBeNull();
    expect(prefs.telegramLinkToken).toBeNull();
  });
});
