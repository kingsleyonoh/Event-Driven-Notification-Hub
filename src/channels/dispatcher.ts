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
  /**
   * True when the email was processed in sandbox mode — logged + counted as
   * sent, but the Resend API was NOT called. Pipeline maps this to
   * `notifications.status = 'sent_sandbox'`. (Phase 7 H5.)
   */
  sandbox?: boolean;
}

export interface DispatchConfig {
  email?: EmailConfig;
  tenantConfig?: Record<string, unknown> | null;
  attachments?: EmailAttachment[];
  /** Template-level reply_to (from `templates.reply_to` column, if set). */
  templateReplyTo?: string | null;
  /** Event-level reply_to (from event payload `_reply_to`, if present). */
  eventReplyTo?: string | null;
  /**
   * Custom email headers — already rendered through Handlebars by the
   * pipeline. Forwarded directly to Resend's `headers` field. Pipeline
   * soft-fails individual headers (skip + warn) before reaching here.
   */
  headers?: Record<string, string>;
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
        const resolvedReplyTo = resolveReplyTo(config, emailConfig);
        const finalConfig: EmailConfig = {
          ...emailConfig,
          ...(resolvedReplyTo !== undefined ? { replyTo: resolvedReplyTo } : { replyTo: undefined }),
          ...(config?.attachments && config.attachments.length > 0
            ? { attachments: config.attachments }
            : {}),
          ...(config?.headers && Object.keys(config.headers).length > 0
            ? { headers: config.headers }
            : {}),
        };
        // Strip replyTo if undefined so EmailConfig doesn't carry an explicit `replyTo: undefined`
        if (finalConfig.replyTo === undefined) {
          delete finalConfig.replyTo;
        }
        return sendEmail(address, subject, body, finalConfig, {
          notificationId: metadata.notificationId,
          tenantId: metadata.tenantId,
        });
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

/**
 * Three-layer reply_to resolution:
 *   1. event payload `_reply_to` (passed via `config.eventReplyTo`)
 *   2. template `reply_to` column (passed via `config.templateReplyTo`)
 *   3. tenant `config.channels.email.replyTo` (already on resolved EmailConfig)
 *
 * Returns `undefined` if all three layers are absent — caller deletes the field.
 */
function resolveReplyTo(
  config: DispatchConfig | undefined,
  emailConfig: EmailConfig,
): string | undefined {
  if (config?.eventReplyTo) return config.eventReplyTo;
  if (config?.templateReplyTo) return config.templateReplyTo;
  if (emailConfig.replyTo) return emailConfig.replyTo;
  return undefined;
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
