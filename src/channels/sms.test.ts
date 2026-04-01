import { describe, it, expect, vi } from 'vitest';
import { sendSms } from './sms.js';

// Spy on the logger to verify logging behavior
vi.mock('../lib/logger.js', () => {
  const infoFn = vi.fn();
  return {
    createLogger: vi.fn().mockReturnValue({
      info: infoFn,
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    __mockInfo: infoFn,
  };
});

async function getMockInfo() {
  const mod = await import('../lib/logger.js');
  return (mod as unknown as { __mockInfo: ReturnType<typeof vi.fn> }).__mockInfo;
}

describe('sendSms (stub)', () => {
  it('returns success for any SMS', async () => {
    const result = await sendSms('+15551234567', 'Your order shipped!', {
      tenantId: 'test-tenant',
      notificationId: 'notif-1',
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('logs the SMS message at info level', async () => {
    const mockInfo = await getMockInfo();
    mockInfo.mockClear();

    await sendSms('+15559876543', 'Shift starts at 8am', {
      tenantId: 'tenant-abc',
      notificationId: 'notif-2',
    });

    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+15559876543',
        notificationId: 'notif-2',
      }),
      expect.stringContaining('SMS'),
    );
  });
});
