// Phase 7 H6 — Multiple verified Resend domains per tenant.
// Verifies the domain priority chain in `dispatch()`:
//   1. Rule-level `from_domain_override`
//   2. Tenant-level default in `fromDomains`
//   3. Legacy single-domain `from` (backward compat)
import { describe, it, expect, vi } from 'vitest';
import { dispatch } from './dispatcher.js';

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

describe('dispatch (Phase 7 H6 — multi-domain From resolution)', () => {
  it('rule-level fromDomainOverride wins over tenant fromDomains default', async () => {
    const { sendEmail } = await import('./email.js');
    vi.mocked(sendEmail).mockClear();

    const result = await dispatch(
      'email', 'user@example.com', 'Subject', 'Body',
      { tenantId: 'test', notificationId: 'n-h6-1' },
      {
        tenantConfig: {
          channels: {
            email: {
              apiKey: 're_key',
              from: 'Notifications <notify@main.com>',
              fromDomains: [
                { domain: 'main.com', default: true },
                { domain: 'alt.com', default: false },
              ],
            },
          },
        },
        ruleFromDomainOverride: 'alt.com',
      },
    );

    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      'user@example.com', 'Subject', 'Body',
      expect.objectContaining({ from: 'Notifications <notify@alt.com>' }),
      { notificationId: 'n-h6-1', tenantId: 'test' },
    );
  });

  it('uses tenant fromDomains default when rule has no override', async () => {
    const { sendEmail } = await import('./email.js');
    vi.mocked(sendEmail).mockClear();

    const result = await dispatch(
      'email', 'user@example.com', 'Subject', 'Body',
      { tenantId: 'test', notificationId: 'n-h6-2' },
      {
        tenantConfig: {
          channels: {
            email: {
              apiKey: 're_key',
              from: 'Notifications <notify@legacy.com>',
              fromDomains: [
                { domain: 'main.com', default: true },
                { domain: 'alt.com', default: false },
              ],
            },
          },
        },
      },
    );

    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      'user@example.com', 'Subject', 'Body',
      expect.objectContaining({ from: 'Notifications <notify@main.com>' }),
      { notificationId: 'n-h6-2', tenantId: 'test' },
    );
  });

  it('preserves legacy single-domain from string verbatim when fromDomains is absent (backward compat)', async () => {
    const { sendEmail } = await import('./email.js');
    vi.mocked(sendEmail).mockClear();

    const result = await dispatch(
      'email', 'user@example.com', 'Subject', 'Body',
      { tenantId: 'test', notificationId: 'n-h6-3' },
      {
        tenantConfig: {
          channels: {
            email: { apiKey: 're_key', from: 'notify@legacy.com' },
          },
        },
      },
    );

    expect(result.success).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      'user@example.com', 'Subject', 'Body',
      expect.objectContaining({ from: 'notify@legacy.com' }),
      { notificationId: 'n-h6-3', tenantId: 'test' },
    );
  });
});
