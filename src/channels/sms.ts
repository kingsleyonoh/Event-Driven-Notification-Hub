import { createLogger } from '../lib/logger.js';
import type { DispatchResult } from './dispatcher.js';

const logger = createLogger('sms');

export async function sendSms(
  to: string,
  body: string,
  metadata: { tenantId: string; notificationId: string },
): Promise<DispatchResult> {
  logger.info(
    { to, body, tenantId: metadata.tenantId, notificationId: metadata.notificationId },
    'SMS sent (stub — no real delivery)',
  );

  return { success: true };
}
