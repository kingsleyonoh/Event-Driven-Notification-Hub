import { describe, it, expect, vi } from 'vitest';
import { dispatch } from './dispatcher.js';

// Mock channel handlers to verify routing
vi.mock('./email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('./sms.js', () => ({
  sendSms: vi.fn().mockResolvedValue({ success: true }),
}));

describe('dispatch (stub — no config)', () => {
  it('returns success for email channel without config (stub fallback)', async () => {
    const result = await dispatch('email', 'test@example.com', 'Subject', 'Body', {
      tenantId: 'test', notificationId: 'n-1',
    });
    expect(result.success).toBe(true);
  });

  it('returns success for sms channel', async () => {
    const result = await dispatch('sms', '+15551234567', null, 'SMS body', {
      tenantId: 'test', notificationId: 'n-2',
    });
    expect(result.success).toBe(true);
  });

  it('returns success for in_app channel (stub)', async () => {
    const result = await dispatch('in_app', 'user-123', null, 'In-app message', {
      tenantId: 'test', notificationId: 'n-3',
    });
    expect(result.success).toBe(true);
  });
});

describe('dispatch (with config — routes to real handlers)', () => {
  it('routes email to sendEmail when config.email is provided', async () => {
    const { sendEmail } = await import('./email.js');

    const result = await dispatch(
      'email', 'user@example.com', 'Subject', 'Body',
      { tenantId: 'test', notificationId: 'n-10' },
      { email: { apiKey: 're_test', from: 'noreply@test.com' } },
    );

    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      'user@example.com', 'Subject', 'Body',
      { apiKey: 're_test', from: 'noreply@test.com' },
    );
  });

  it('routes sms to sendSms handler', async () => {
    const { sendSms } = await import('./sms.js');

    const result = await dispatch(
      'sms', '+15551234567', null, 'SMS body',
      { tenantId: 'test', notificationId: 'n-11' },
      { email: { apiKey: 're_test', from: 'noreply@test.com' } },
    );

    expect(result.success).toBe(true);
    expect(sendSms).toHaveBeenCalledWith(
      '+15551234567', 'SMS body',
      { tenantId: 'test', notificationId: 'n-11' },
    );
  });

  it('falls back to stub for in_app channel', async () => {
    const result = await dispatch(
      'in_app', 'user-123', null, 'In-app msg',
      { tenantId: 'test', notificationId: 'n-12' },
      { email: { apiKey: 're_test', from: 'noreply@test.com' } },
    );

    expect(result.success).toBe(true);
  });
});
