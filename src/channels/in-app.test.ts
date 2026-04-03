import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendInApp } from './in-app.js';

// Mock the connection manager
vi.mock('../ws/handler.js', () => ({
  pushToUser: vi.fn(),
}));

describe('sendInApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success and pushes when user is connected', async () => {
    const { pushToUser } = await import('../ws/handler.js');
    vi.mocked(pushToUser).mockReturnValue(true);

    const result = await sendInApp('user-1', 'Alert', 'Something happened', {
      tenantId: 'tenant-a',
      notificationId: 'notif-1',
      eventType: 'order.completed',
    });

    expect(result.success).toBe(true);
    expect(pushToUser).toHaveBeenCalledWith('tenant-a', 'user-1', expect.objectContaining({
      id: 'notif-1',
      tenant_id: 'tenant-a',
      event_type: 'order.completed',
      channel: 'in_app',
      subject: 'Alert',
      body_preview: 'Something happened',
    }));
  });

  it('returns success when user is not connected (stored as unread)', async () => {
    const { pushToUser } = await import('../ws/handler.js');
    vi.mocked(pushToUser).mockReturnValue(false);

    const result = await sendInApp('offline-user', 'Subject', 'Body', {
      tenantId: 'tenant-a',
      notificationId: 'notif-2',
      eventType: 'task.assigned',
    });

    expect(result.success).toBe(true);
  });

  it('constructs correct WebSocket payload format', async () => {
    const { pushToUser } = await import('../ws/handler.js');
    vi.mocked(pushToUser).mockReturnValue(true);

    await sendInApp('user-1', null, 'No subject notification', {
      tenantId: 'tenant-b',
      notificationId: 'notif-3',
      eventType: 'comment.added',
    });

    expect(pushToUser).toHaveBeenCalledWith('tenant-b', 'user-1', expect.objectContaining({
      id: 'notif-3',
      tenant_id: 'tenant-b',
      event_type: 'comment.added',
      channel: 'in_app',
      subject: null,
      body_preview: 'No subject notification',
      created_at: expect.any(String),
    }));
  });
});
