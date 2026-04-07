import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TelegramConfig } from './telegram.js';

// We'll test sendTelegram with mocked global.fetch (Node 22 native fetch).
// Telegram Bot API is a third-party API — mocking is correct per policy.

describe('sendTelegram', () => {
  const config: TelegramConfig = {
    botToken: 'bot123:ABC-DEF',
    botUsername: 'test_bot',
  };
  const chatId = '12345678';

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns success when Telegram API responds with ok:true', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { message_id: 999 } }),
    });

    // Dynamic import to pick up the mocked fetch
    const { sendTelegram } = await import('./telegram.js');

    const result = await sendTelegram(chatId, 'Alert', 'Server is down', config);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${config.botToken}/sendMessage`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '*Alert*\n\nServer is down',
          parse_mode: 'Markdown',
        }),
      }),
    );
  });

  it('returns failure with error message when Telegram API returns ok:false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ ok: false, description: 'Bad Request: chat not found' }),
    });

    const { sendTelegram } = await import('./telegram.js');

    const result = await sendTelegram(chatId, 'Alert', 'body', config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('chat not found');
  });

  it('returns failure when fetch throws a network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network timeout'));

    const { sendTelegram } = await import('./telegram.js');

    const result = await sendTelegram(chatId, 'Alert', 'body', config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('network timeout');
  });

  it('sends body-only text when subject is null', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, result: { message_id: 100 } }),
    });

    const { sendTelegram } = await import('./telegram.js');

    const result = await sendTelegram(chatId, null, 'Just the body', config);

    expect(result.success).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({
          chat_id: chatId,
          text: 'Just the body',
          parse_mode: 'Markdown',
        }),
      }),
    );
  });
});
