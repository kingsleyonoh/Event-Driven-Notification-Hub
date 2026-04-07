import { sendEmail, type EmailConfig } from './email.js';
import { sendSms } from './sms.js';
import { sendInApp } from './in-app.js';
import { resolveTenantChannelConfig } from '../lib/channel-config.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('dispatcher');

export interface DispatchResult {
  success: boolean;
  error?: string;
}

export interface DispatchConfig {
  email?: EmailConfig;
  tenantConfig?: Record<string, unknown> | null;
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
    case 'email': {
      const emailConfig = resolveEmailConfig(config);
      if (emailConfig) {
        return sendEmail(address, subject, body, emailConfig);
      }
      logger.info(
        { channel, address, subject, notificationId: metadata.notificationId },
        'dispatching notification (stub)',
      );
      return { success: true };
    }

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

function resolveEmailConfig(config?: DispatchConfig): EmailConfig | null {
  // 1. Try tenant-level config first
  if (config?.tenantConfig) {
    const tenantEmail = resolveTenantChannelConfig(config.tenantConfig, 'email');
    if (tenantEmail) {
      return tenantEmail as unknown as EmailConfig;
    }
  }

  // 2. Fall back to explicit email config (env-level)
  if (config?.email) {
    return config.email;
  }

  return null;
}
