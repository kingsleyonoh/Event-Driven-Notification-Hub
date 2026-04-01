import { Resend } from 'resend';
import { createLogger } from '../lib/logger.js';
import type { DispatchResult } from './dispatcher.js';

const logger = createLogger('email');

export interface EmailConfig {
  apiKey: string;
  from: string;
}

export async function sendEmail(
  to: string,
  subject: string | null,
  body: string,
  config: EmailConfig,
): Promise<DispatchResult> {
  const resend = new Resend(config.apiKey);

  try {
    const { data, error } = await resend.emails.send({
      from: config.from,
      to,
      subject: subject ?? undefined,
      html: body,
    });

    if (error) {
      logger.error({ to, error: error.message }, 'email send failed');
      return { success: false, error: error.message };
    }

    logger.info({ to, messageId: data?.id }, 'email sent');
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown email error';
    logger.error({ to, error: message }, 'email send threw');
    return { success: false, error: message };
  }
}
