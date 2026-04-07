import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import { createTestTenant, createTestPreferences, cleanupTestData } from '../test/factories.js';
import { userPreferences } from '../db/schema.js';

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let originalFetch: typeof globalThis.fetch;

beforeAll(async () => {
  tenant = await createTestTenant(db, {
    config: {
      channels: {
        telegram: { botToken: 'bot123:TEST-TOKEN', botUsername: 'test_bot' },
      },
    },
  });
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('pollTelegramUpdates', () => {
  it('links telegram chat when /start token matches a user', async () => {
    const token = 'valid-link-token-123';
    await createTestPreferences(db, tenant.id, 'tg-user-1', {
      telegramLinkToken: token,
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [
          {
            update_id: 1001,
            message: {
              text: `/start ${token}`,
              chat: { id: 99887766 },
            },
          },
        ],
      }),
    });

    const { pollTelegramUpdates } = await import('./telegram-bot.js');
    const botStates = new Map();
    await pollTelegramUpdates(db, botStates);

    // Verify telegram_chat_id was set and token was cleared
    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.tenantId, tenant.id),
          eq(userPreferences.userId, 'tg-user-1'),
        ),
      );

    expect(prefs.telegramChatId).toBe('99887766');
    expect(prefs.telegramLinkToken).toBeNull();
  });

  it('does nothing for unknown token', async () => {
    // Create a user with a DIFFERENT token
    await createTestPreferences(db, tenant.id, 'tg-user-2', {
      telegramLinkToken: 'real-token-xyz',
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [
          {
            update_id: 2001,
            message: {
              text: '/start unknown-token-abc',
              chat: { id: 11112222 },
            },
          },
        ],
      }),
    });

    const { pollTelegramUpdates } = await import('./telegram-bot.js');
    const botStates = new Map();
    await pollTelegramUpdates(db, botStates);

    // User's preferences should be unchanged
    const [prefs] = await db
      .select()
      .from(userPreferences)
      .where(
        and(
          eq(userPreferences.tenantId, tenant.id),
          eq(userPreferences.userId, 'tg-user-2'),
        ),
      );

    expect(prefs.telegramLinkToken).toBe('real-token-xyz');
    expect(prefs.telegramChatId).toBeNull();
  });

  it('handles empty result array without errors', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [],
      }),
    });

    const { pollTelegramUpdates } = await import('./telegram-bot.js');
    const botStates = new Map();

    // Should not throw
    await expect(pollTelegramUpdates(db, botStates)).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('skips malformed updates without message or chat.id', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        result: [
          { update_id: 3001 }, // no message at all
          { update_id: 3002, message: { text: '/start some-token' } }, // no chat
          { update_id: 3003, message: { chat: { id: 555 } } }, // no text
        ],
      }),
    });

    const { pollTelegramUpdates } = await import('./telegram-bot.js');
    const botStates = new Map();

    // Should not throw — all malformed updates gracefully skipped
    await expect(pollTelegramUpdates(db, botStates)).resolves.toBeUndefined();
  });
});

describe('createTelegramBotWorker', () => {
  it('returns an object with poll function', async () => {
    const { createTelegramBotWorker } = await import('./telegram-bot.js');
    const worker = createTelegramBotWorker(db);

    expect(worker).toBeDefined();
    expect(typeof worker.poll).toBe('function');
  });
});
