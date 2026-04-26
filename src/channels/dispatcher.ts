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
  /**
   * Phase 7 H8 — rendered plain-text body fallback (from `templates.body_text`).
   * Forwarded to Resend's `text` field; when undefined/empty Resend
   * auto-generates the text alternative from the HTML body.
   */
  text?: string;
  /**
   * Phase 7 H6 — rule-level sending-domain override
   * (`notification_rules.from_domain_override`). When set, the dispatcher
   * uses this domain in preference to the tenant-level `fromDomains`
   * default. Null/undefined → fall through to tenant default.
   */
  ruleFromDomainOverride?: string | null;
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
        const resolvedFrom = resolveFromAddress(emailConfig, config);
        const resolvedReplyTo = resolveReplyTo(config, emailConfig);
        // `fromDomains` is the dispatcher's input only — strip it before
        // the config crosses into `sendEmail` (it's not in EmailConfig).
        const { fromDomains: _fromDomains, ...emailConfigStripped } = emailConfig;
        void _fromDomains;
        const finalConfig: EmailConfig = {
          ...emailConfigStripped,
          from: resolvedFrom,
          ...(resolvedReplyTo !== undefined ? { replyTo: resolvedReplyTo } : { replyTo: undefined }),
          ...(config?.attachments && config.attachments.length > 0
            ? { attachments: config.attachments }
            : {}),
          ...(config?.headers && Object.keys(config.headers).length > 0
            ? { headers: config.headers }
            : {}),
          ...(config?.text && config.text.length > 0
            ? { text: config.text }
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

/**
 * Internal carrier shape: the resolver may attach `fromDomains` (Phase 7 H6)
 * onto the email config so `dispatch()` can pick a domain. We strip the
 * field before the config reaches `sendEmail` — it's not part of EmailConfig.
 */
type ResolvedEmailConfig = EmailConfig & {
  fromDomains?: Array<{ domain: string; default: boolean }>;
};

function resolveEmailConfig(config?: DispatchConfig): ResolvedEmailConfig | null {
  // 1. Try tenant-level config first
  if (config?.tenantConfig) {
    const tenantEmail = resolveTenantChannelConfig(config.tenantConfig, 'email');
    if (tenantEmail) {
      return tenantEmail as unknown as ResolvedEmailConfig;
    }
  }

  // 2. Fall back to explicit email config (env-level)
  if (config?.email) {
    return config.email;
  }

  return null;
}

/**
 * Phase 7 H6 — pick the sending domain via priority chain:
 *   1. Rule-level override (`config.ruleFromDomainOverride`)
 *   2. Tenant-level default in `fromDomains`
 *   3. First entry in `fromDomains` (defensive — superRefine should
 *      ensure exactly one default exists)
 *   4. Legacy `from` string passed through verbatim (backward compat)
 *
 * When a domain is chosen from `fromDomains`, the local-part comes from
 * the original `config.from` string — e.g.
 *   `Notifications <notify@x.com>` → `Notifications <notify@chosen.com>`
 *   `notify@x.com`                  → `notify@chosen.com`
 *
 * If `from` lacks an `@` and `fromDomains` is set, default the local-part
 * to `notifications` (PRD doesn't specify; reasonable default).
 */
function resolveFromAddress(
  emailConfig: ResolvedEmailConfig,
  dispatchConfig?: DispatchConfig,
): string {
  const fromDomains = emailConfig.fromDomains;

  // Step 4 — legacy single-domain (no fromDomains) → pass through verbatim
  if (!fromDomains || fromDomains.length === 0) {
    return emailConfig.from;
  }

  const ruleOverride = dispatchConfig?.ruleFromDomainOverride;
  let chosenDomain: string | undefined;

  // Step 1 — rule-level override (must match a verified domain in the list
  // to be honored; otherwise fall through to tenant default).
  if (ruleOverride && fromDomains.some((d) => d.domain === ruleOverride)) {
    chosenDomain = ruleOverride;
  }

  // Step 2 — tenant-level default
  if (!chosenDomain) {
    const def = fromDomains.find((d) => d.default);
    if (def) chosenDomain = def.domain;
  }

  // Step 3 — defensive: first entry
  if (!chosenDomain) {
    chosenDomain = fromDomains[0].domain;
  }

  return composeFromAddress(emailConfig.from, chosenDomain);
}

/**
 * Combine the local-part of `originalFrom` with `chosenDomain`, preserving
 * any RFC-5322 display name. Examples:
 *   ('Notifications <notify@x.com>', 'alt.com') → 'Notifications <notify@alt.com>'
 *   ('notify@x.com',                  'alt.com') → 'notify@alt.com'
 *   ('',                              'alt.com') → 'notifications@alt.com'
 */
function composeFromAddress(originalFrom: string, chosenDomain: string): string {
  // Try to extract `<local@domain>` from a display-name form first.
  const angleMatch = originalFrom.match(/^(.*)<([^@>]+)@[^>]+>\s*$/);
  if (angleMatch) {
    const displayName = angleMatch[1].trim();
    const localPart = angleMatch[2].trim();
    return displayName.length > 0
      ? `${displayName} <${localPart}@${chosenDomain}>`
      : `${localPart}@${chosenDomain}`;
  }

  // Plain `local@domain` form
  const atIdx = originalFrom.indexOf('@');
  if (atIdx > 0) {
    return `${originalFrom.slice(0, atIdx)}@${chosenDomain}`;
  }

  // No `@` at all → reasonable default local-part
  return `notifications@${chosenDomain}`;
}
