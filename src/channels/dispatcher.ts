import { createLogger } from '../lib/logger.js';

const logger = createLogger('dispatcher');

export interface DispatchResult {
  success: boolean;
  error?: string;
}

export async function dispatch(
  channel: 'email' | 'sms' | 'in_app',
  address: string,
  subject: string | null,
  body: string,
  metadata: { tenantId: string; notificationId: string },
): Promise<DispatchResult> {
  // Stub — real channel handlers (email.ts, sms.ts, in-app.ts) will replace this
  logger.info(
    { channel, address, subject, notificationId: metadata.notificationId },
    'dispatching notification (stub)',
  );

  return { success: true };
}
