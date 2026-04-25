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
  /**
   * Phase 7 H8 — optional plain-text alternative body forwarded to Resend's
   * `text` field. When omitted (or empty), Resend auto-generates the text
   * alternative from the HTML body. Pipeline only sets this when the
   * template's `body_text` column is non-null.
   */
  text?: string;
  /**
   * Phase 7 H5 — when true, the Hub logs the outgoing email at info level
   * (subject + recipient + body excerpt) and SKIPS the Resend send. Used
   * by tenants in dev/staging to exercise the pipeline without delivering
   * real mail. The pipeline maps the resulting `sandbox: true` flag on
   * DispatchResult to `notifications.status = 'sent_sandbox'`.
   */
  sandbox?: boolean;
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
  // Phase 7 H5 — sandbox short-circuit: log + return success, no Resend call.
  // Body excerpt is capped at 200 chars to keep log volume bounded.
  if (config.sandbox === true) {
    logger.info(
      {
        to,
        subject: subject ?? '',
        bodyExcerpt: body.slice(0, 200),
        sandbox: true,
        ...(metadata ? { notificationId: metadata.notificationId } : {}),
      },
      'email sandboxed — Resend send skipped',
    );
    return { success: true, sandbox: true };
  }

  const resend = new Resend(config.apiKey);

  try {
    const sendPayload: {
      from: string;
      to: string;
      subject: string;
      html: string;
      text?: string;
      replyTo?: string;
      attachments?: EmailAttachment[];
      headers?: Record<string, string>;
    } = {
      from: config.from,
      to,
      subject: subject ?? '',
      html: body,
    };

    // Phase 7 H8 — plain-text fallback. Only set when caller supplied a
    // non-empty string; empty/undefined → omit so Resend auto-generates.
    if (config.text !== undefined && config.text.length > 0) {
      sendPayload.text = config.text;
    }

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
