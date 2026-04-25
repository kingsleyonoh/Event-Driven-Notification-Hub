import { sendEmail, type EmailConfig, type EmailAttachment } from './email.js';
import { sendSms } from './sms.js';
import { sendInApp } from './in-app.js';
import { sendTelegram, type TelegramConfig } from './telegram.js';
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
  attachments?: EmailAttachment[];
}

export async function dispatch(
  channel: 'email' | 'sms' | 'in_app' | 'telegram',
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
        const finalConfig: EmailConfig = config?.attachments && config.attachments.length > 0
          ? { ...emailConfig, attachments: config.attachments }
          : emailConfig;
        return sendEmail(address, subject, body, finalConfig);
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

    case 'telegram': {
      const telegramConfig = resolveTelegramConfig(config);
      if (telegramConfig) {
        return sendTelegram(address, subject, body, telegramConfig);
      }
      logger.warn(
        { channel, notificationId: metadata.notificationId },
        'no telegram config — skipping',
      );
      return { success: false, error: 'no telegram config for tenant' };
    }
  }
}

function resolveTelegramConfig(config?: DispatchConfig): TelegramConfig | null {
  if (config?.tenantConfig) {
    const tenantTelegram = resolveTenantChannelConfig(config.tenantConfig, 'telegram');
    if (tenantTelegram) {
      return tenantTelegram as unknown as TelegramConfig;
    }
  }
  return null;
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
