import { Resend } from 'resend';
import { createLogger } from '../lib/logger.js';
import { recordEmailResult } from './email-monitor.js';
import type { DispatchResult } from './dispatcher.js';

const logger = createLogger('email');

export interface EmailAttachment {
  filename: string;
  content: string;
}

export interface EmailConfig {
  apiKey: string;
  from: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
}

/**
 * Optional metadata that the dispatcher passes through to round-trip the
 * notification + tenant identity back to the Resend webhook handler.
 *
 * We forward these as custom headers (`X-Hub-Notification-ID` and
 * `X-Hub-Tenant-ID`) on the Resend send request — Resend echoes custom
 * headers in its webhook payload's `data.headers` field, which the
 * `/api/webhooks/resend` route uses to correlate the delivery event back
 * to the originating notification row without leaking either ID into the
 * email message itself.
 */
export interface EmailSendMetadata {
  notificationId: string;
  tenantId: string;
}

export async function sendEmail(
  to: string,
  subject: string | null,
  body: string,
  config: EmailConfig,
  metadata?: EmailSendMetadata,
): Promise<DispatchResult> {
  const resend = new Resend(config.apiKey);

  try {
    const sendPayload: {
      from: string;
      to: string;
      subject: string;
      html: string;
      replyTo?: string;
      attachments?: EmailAttachment[];
      headers?: Record<string, string>;
    } = {
      from: config.from,
      to,
      subject: subject ?? '',
      html: body,
    };

    if (config.replyTo) {
      sendPayload.replyTo = config.replyTo;
    }

    if (config.attachments && config.attachments.length > 0) {
      sendPayload.attachments = config.attachments;
    }

    // Merge correlation headers (X-Hub-*) with template-supplied custom headers.
    // Template headers come first; we never let a template-supplied value
    // overwrite the correlation headers — the X-Hub-* keys are reserved.
    const mergedHeaders: Record<string, string> = { ...(config.headers ?? {}) };
    if (metadata) {
      mergedHeaders['X-Hub-Notification-ID'] = metadata.notificationId;
      mergedHeaders['X-Hub-Tenant-ID'] = metadata.tenantId;
    }
    if (Object.keys(mergedHeaders).length > 0) {
      sendPayload.headers = mergedHeaders;
    }

    const { data, error } = await resend.emails.send(sendPayload);

    if (error) {
      logger.error({ to, error: error.message }, 'email send failed');
      recordEmailResult(false);
      return { success: false, error: error.message };
    }

    logger.info({ to, messageId: data?.id }, 'email sent');
    recordEmailResult(true);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown email error';
    logger.error({ to, error: message }, 'email send threw');
    recordEmailResult(false);
    return { success: false, error: message };
  }
}
