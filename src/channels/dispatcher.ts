import { sendEmail, type EmailConfig } from './email.js';
import { sendSms } from './sms.js';
import { sendInApp } from './in-app.js';
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
  metadata: { tenantId: string; notificationId: string; eventType?: string },
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
      return sendInApp(address, subject, body, {
        tenantId: metadata.tenantId,
        notificationId: metadata.notificationId,
        eventType: metadata.eventType ?? 'unknown',
      });
  }
}
