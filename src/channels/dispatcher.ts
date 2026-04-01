import { sendEmail, type EmailConfig } from './email.js';
import { sendSms } from './sms.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('dispatcher');

export interface DispatchResult {
  success: boolean;
  error?: string;
}

export interface DispatchConfig {
  email?: EmailConfig;
}

export async function dispatch(
  channel: 'email' | 'sms' | 'in_app',
  address: string,
  subject: string | null,
  body: string,
  metadata: { tenantId: string; notificationId: string },
  config?: DispatchConfig,
): Promise<DispatchResult> {
  switch (channel) {
    case 'email':
      if (config?.email) {
        return sendEmail(address, subject, body, config.email);
      }
      logger.info(
        { channel, address, subject, notificationId: metadata.notificationId },
        'dispatching notification (stub)',
      );
      return { success: true };

    case 'sms':
      return sendSms(address, body, metadata);

    case 'in_app':
      // Stub — WebSocket handler will replace this in Phase 3
      logger.info(
        { channel, address, notificationId: metadata.notificationId },
        'dispatching notification (stub)',
      );
      return { success: true };
  }
}
