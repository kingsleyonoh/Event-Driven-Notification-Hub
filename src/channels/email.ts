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
}

export async function sendEmail(
  to: string,
  subject: string | null,
  body: string,
  config: EmailConfig,
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
