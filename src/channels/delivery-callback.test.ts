import { describe, it, expect } from 'vitest';
import { signPayload, type DeliveryCallbackEvent } from './delivery-callback.js';

describe('signPayload (HMAC-SHA256 outbound callback signing)', () => {
  const fixedEvent: DeliveryCallbackEvent = {
    event_type: 'email.delivered',
    resend_email_id: 'email_abc123',
    notification_id: '11111111-2222-3333-4444-555555555555',
    payload: { to: 'user@example.com', subject: 'Hello' },
    created_at: '2026-04-25T10:00:00.000Z',
  };

  it('produces identical signatures given the same secret + payload', () => {
    const secret = 'd34db33fcafef00d0123456789abcdef';

    const sig1 = signPayload(fixedEvent, secret);
    const sig2 = signPayload(fixedEvent, secret);

    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{64}$/); // sha256 hex digest
  });

  it('produces different signatures for different secrets on the same payload', () => {
    const secretA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const secretB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    const sigA = signPayload(fixedEvent, secretA);
    const sigB = signPayload(fixedEvent, secretB);

    expect(sigA).not.toBe(sigB);
    expect(sigA).toMatch(/^[0-9a-f]{64}$/);
    expect(sigB).toMatch(/^[0-9a-f]{64}$/);
  });
});
