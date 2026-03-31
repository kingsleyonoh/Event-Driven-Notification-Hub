import { describe, it, expect } from 'vitest';
import { dispatch } from './dispatcher.js';

describe('dispatch (stub)', () => {
  it('returns success for email channel', async () => {
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

  it('returns success for in_app channel', async () => {
    const result = await dispatch('in_app', 'user-123', null, 'In-app message', {
      tenantId: 'test', notificationId: 'n-3',
    });
    expect(result.success).toBe(true);
  });
});
