import { pushToUser } from '../ws/handler.js';
import { createLogger } from '../lib/logger.js';
import type { DispatchResult } from './dispatcher.js';

const logger = createLogger('in-app');

export async function sendInApp(
  userId: string,
  subject: string | null,
  body: string,
  metadata: { tenantId: string; notificationId: string; eventType: string },
): Promise<DispatchResult> {
  const payload = {
    id: metadata.notificationId,
    tenant_id: metadata.tenantId,
    event_type: metadata.eventType,
    channel: 'in_app' as const,
    subject,
    body_preview: body,
    created_at: new Date().toISOString(),
  };

  const pushed = pushToUser(metadata.tenantId, userId, payload);

  if (pushed) {
    logger.info({ userId, notificationId: metadata.notificationId }, 'pushed to WebSocket');
  } else {
    logger.debug({ userId, notificationId: metadata.notificationId }, 'user not connected — stored as unread');
  }

  // Always return success — notification is stored by the pipeline regardless.
  // If user is offline, they fetch unread on reconnect.
  return { success: true };
}
