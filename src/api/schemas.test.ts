import { describe, it, expect } from 'vitest';
import { channelEnum, upsertPreferencesSchema } from './schemas.js';

describe('channelEnum', () => {
  it('accepts telegram as a valid channel', () => {
    const result = channelEnum.safeParse('telegram');
    expect(result.success).toBe(true);
  });

  it('still accepts existing channels', () => {
    for (const ch of ['email', 'sms', 'in_app']) {
      const result = channelEnum.safeParse(ch);
      expect(result.success).toBe(true);
    }
  });

  it('rejects unknown channels', () => {
    const result = channelEnum.safeParse('pigeon');
    expect(result.success).toBe(false);
  });
});

describe('upsertPreferencesSchema — telegram_chat_id', () => {
  it('accepts telegram_chat_id as optional string', () => {
    const result = upsertPreferencesSchema.safeParse({
      telegram_chat_id: '123456789',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.telegram_chat_id).toBe('123456789');
    }
  });

  it('accepts payload without telegram_chat_id', () => {
    const result = upsertPreferencesSchema.safeParse({
      email: 'user@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-string telegram_chat_id', () => {
    const result = upsertPreferencesSchema.safeParse({
      telegram_chat_id: 12345,
    });
    expect(result.success).toBe(false);
  });
});
