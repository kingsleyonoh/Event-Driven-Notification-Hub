import { describe, it, expect, vi } from 'vitest';
import { dispatch } from './dispatcher.js';

// Mock channel handlers to verify routing
vi.mock('./email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('./sms.js', () => ({
  sendSms: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('./in-app.js', () => ({
  sendInApp: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('./telegram.js', () => ({
  sendTelegram: vi.fn().mockResolvedValue({ success: true }),
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
      { notificationId: 'n-10', tenantId: 'test' },
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

  it('routes in_app to sendInApp handler', async () => {
    const { sendInApp } = await import('./in-app.js');

    const result = await dispatch(
      'in_app', 'user-123', null, 'In-app msg',
      { tenantId: 'test', notificationId: 'n-12', eventType: 'order.completed' },
      { email: { apiKey: 're_test', from: 'noreply@test.com' } },
    );

    expect(result.success).toBe(true);
    expect(sendInApp).toHaveBeenCalledWith(
      'user-123', null, 'In-app msg',
      { tenantId: 'test', notificationId: 'n-12', eventType: 'order.completed' },
    );
  });
});

describe('dispatch (with tenantConfig — per-tenant channel credentials)', () => {
  it('uses tenant-level email config when tenantConfig has email channel', async () => {
    const { sendEmail } = await import('./email.js');
    vi.mocked(sendEmail).mockClear();

    const result = await dispatch(
      'email', 'user@example.com', 'Subject', 'Body',
      { tenantId: 'test', notificationId: 'n-20' },
      {
        tenantConfig: {
          channels: {
            email: { apiKey: 're_tenant_key', from: 'sender@tenant.com' },
          },
        },
      },
    );

    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      'user@example.com', 'Subject', 'Body',
      { apiKey: 're_tenant_key', from: 'sender@tenant.com' },
      { notificationId: 'n-20', tenantId: 'test' },
    );
  });

  it('prefers tenant config over env-level email config', async () => {
    const { sendEmail } = await import('./email.js');
    vi.mocked(sendEmail).mockClear();

    const result = await dispatch(
      'email', 'user@example.com', 'Subject', 'Body',
      { tenantId: 'test', notificationId: 'n-21' },
      {
        email: { apiKey: 're_env_key', from: 'env@test.com' },
        tenantConfig: {
          channels: {
            email: { apiKey: 're_tenant_key', from: 'tenant@test.com' },
          },
        },
      },
    );

    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      'user@example.com', 'Subject', 'Body',
      { apiKey: 're_tenant_key', from: 'tenant@test.com' },
      { notificationId: 'n-21', tenantId: 'test' },
    );
  });

  it('falls back to env-level email config when tenant config lacks email', async () => {
    const { sendEmail } = await import('./email.js');
    vi.mocked(sendEmail).mockClear();

    const result = await dispatch(
      'email', 'user@example.com', 'Subject', 'Body',
      { tenantId: 'test', notificationId: 'n-22' },
      {
        email: { apiKey: 're_env_key', from: 'env@test.com' },
        tenantConfig: { channels: {} },
      },
    );

    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      'user@example.com', 'Subject', 'Body',
      { apiKey: 're_env_key', from: 'env@test.com' },
      { notificationId: 'n-22', tenantId: 'test' },
    );
  });

  it('falls back to stub when tenant config has malformed email', async () => {
    const { sendEmail } = await import('./email.js');
    vi.mocked(sendEmail).mockClear();

    const result = await dispatch(
      'email', 'user@example.com', 'Subject', 'Body',
      { tenantId: 'test', notificationId: 'n-23' },
      {
        tenantConfig: {
          channels: {
            email: { apiKey: 're_key' }, // missing 'from'
          },
        },
      },
    );

    expect(result.success).toBe(true);
    // sendEmail should NOT be called — falls through to stub
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('routes telegram to sendTelegram when tenant config has telegram credentials', async () => {
    const { sendTelegram } = await import('./telegram.js');
    vi.mocked(sendTelegram).mockClear();

    const result = await dispatch(
      'telegram', '12345678', 'Alert', 'Server down',
      { tenantId: 'test', notificationId: 'n-30' },
      {
        tenantConfig: {
          channels: {
            telegram: { botToken: 'bot123:ABC', botUsername: 'mybot' },
          },
        },
      },
    );

    expect(result.success).toBe(true);
    expect(sendTelegram).toHaveBeenCalledWith(
      '12345678', 'Alert', 'Server down',
      { botToken: 'bot123:ABC', botUsername: 'mybot' },
    );
  });

  it('returns failure when tenant config lacks telegram credentials', async () => {
    const { sendTelegram } = await import('./telegram.js');
    vi.mocked(sendTelegram).mockClear();

    const result = await dispatch(
      'telegram', '12345678', 'Alert', 'body',
      { tenantId: 'test', notificationId: 'n-31' },
      { tenantConfig: { channels: {} } },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('no telegram config');
    expect(sendTelegram).not.toHaveBeenCalled();
  });
});

describe('dispatch (email reply_to — three-layer resolution)', () => {
  it('uses event-level _reply_to when present (event > template > tenant)', async () => {
    const { sendEmail } = await import('./email.js');
    vi.mocked(sendEmail).mockClear();

    const result = await dispatch(
      'email', 'user@example.com', 'Subject', 'Body',
      { tenantId: 'test', notificationId: 'n-replyto-1' },
      {
        tenantConfig: {
          channels: {
            email: { apiKey: 're_key', from: 'noreply@x.com', replyTo: 'tenant@x.com' },
          },
        },
        templateReplyTo: 'template@x.com',
        eventReplyTo: 'event@x.com',
      },
    );

    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      'user@example.com', 'Subject', 'Body',
      expect.objectContaining({ replyTo: 'event@x.com' }),
      { notificationId: 'n-replyto-1', tenantId: 'test' },
    );
  });

  it('uses template reply_to when event _reply_to absent (template > tenant)', async () => {
    const { sendEmail } = await import('./email.js');
    vi.mocked(sendEmail).mockClear();

    const result = await dispatch(
      'email', 'user@example.com', 'Subject', 'Body',
      { tenantId: 'test', notificationId: 'n-replyto-2' },
      {
        tenantConfig: {
          channels: {
            email: { apiKey: 're_key', from: 'noreply@x.com', replyTo: 'tenant@x.com' },
          },
        },
        templateReplyTo: 'template@x.com',
      },
    );

    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      'user@example.com', 'Subject', 'Body',
      expect.objectContaining({ replyTo: 'template@x.com' }),
      { notificationId: 'n-replyto-2', tenantId: 'test' },
    );
  });

  it('uses tenant replyTo when neither event nor template provide one', async () => {
    const { sendEmail } = await import('./email.js');
    vi.mocked(sendEmail).mockClear();

    const result = await dispatch(
      'email', 'user@example.com', 'Subject', 'Body',
      { tenantId: 'test', notificationId: 'n-replyto-3' },
      {
        tenantConfig: {
          channels: {
            email: { apiKey: 're_key', from: 'noreply@x.com', replyTo: 'tenant@x.com' },
          },
        },
      },
    );

    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      'user@example.com', 'Subject', 'Body',
      expect.objectContaining({ replyTo: 'tenant@x.com' }),
      { notificationId: 'n-replyto-3', tenantId: 'test' },
    );
  });

  it('omits replyTo entirely when all three layers are absent', async () => {
    const { sendEmail } = await import('./email.js');
    vi.mocked(sendEmail).mockClear();

    const result = await dispatch(
      'email', 'user@example.com', 'Subject', 'Body',
      { tenantId: 'test', notificationId: 'n-replyto-4' },
      {
        tenantConfig: {
          channels: {
            email: { apiKey: 're_key', from: 'noreply@x.com' },
          },
        },
      },
    );

    expect(result.success).toBe(true);
    const callArgs = vi.mocked(sendEmail).mock.calls[0][3];
    expect(callArgs).not.toHaveProperty('replyTo');
  });
});
