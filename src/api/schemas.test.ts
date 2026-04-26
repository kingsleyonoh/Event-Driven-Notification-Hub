import { describe, it, expect } from 'vitest';
import {
  channelEnum,
  upsertPreferencesSchema,
  createTemplateSchema,
  updateTemplateSchema,
  createRuleSchema,
  tenantChannelConfigSchema,
} from './schemas.js';

describe('channelEnum', () => {
  it('accepts telegram as a valid channel', () => {
    const result = channelEnum.safeParse('telegram');
    expect(result.success).toBe(true);
  });

  it('still accepts existing channels', () => {
    for (const ch of ['email', 'sms', 'in_app']) {
      const result = channelEnum.safeParse(ch);
      expect(result.success).toBe(true);
    }
  });

  it('rejects unknown channels', () => {
    const result = channelEnum.safeParse('pigeon');
    expect(result.success).toBe(false);
  });
});

describe('upsertPreferencesSchema — telegram_chat_id', () => {
  it('accepts telegram_chat_id as optional string', () => {
    const result = upsertPreferencesSchema.safeParse({
      telegram_chat_id: '123456789',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.telegram_chat_id).toBe('123456789');
    }
  });

  it('accepts payload without telegram_chat_id', () => {
    const result = upsertPreferencesSchema.safeParse({
      email: 'user@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-string telegram_chat_id', () => {
    const result = upsertPreferencesSchema.safeParse({
      telegram_chat_id: 12345,
    });
    expect(result.success).toBe(false);
  });
});

describe('createTemplateSchema — attachments_config', () => {
  const valid = {
    name: 'invoice',
    channel: 'email',
    body: 'Body',
  };

  it('accepts a payload without attachments_config', () => {
    const result = createTemplateSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('accepts a valid attachments_config array', () => {
    const result = createTemplateSchema.safeParse({
      ...valid,
      attachments_config: [
        { filename_template: '{{invoice_number}}.pdf', url_field: 'pdf_signed_url' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.attachments_config).toEqual([
        { filename_template: '{{invoice_number}}.pdf', url_field: 'pdf_signed_url' },
      ]);
    }
  });

  it('accepts attachments_config = null', () => {
    const result = createTemplateSchema.safeParse({
      ...valid,
      attachments_config: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty filename_template', () => {
    const result = createTemplateSchema.safeParse({
      ...valid,
      attachments_config: [{ filename_template: '', url_field: 'pdf_signed_url' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty url_field', () => {
    const result = createTemplateSchema.safeParse({
      ...valid,
      attachments_config: [{ filename_template: 'x.pdf', url_field: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown fields inside an attachment entry', () => {
    const result = createTemplateSchema.safeParse({
      ...valid,
      attachments_config: [
        { filename_template: 'x.pdf', url_field: 'pdf', extra: 'nope' },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('updateTemplateSchema — attachments_config', () => {
  it('accepts attachments_config on update', () => {
    const result = updateTemplateSchema.safeParse({
      attachments_config: [
        { filename_template: '{{n}}.pdf', url_field: 'url' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts attachments_config = null on update (clears config)', () => {
    const result = updateTemplateSchema.safeParse({
      attachments_config: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('createTemplateSchema — headers (RFC 8058 List-Unsubscribe)', () => {
  const valid = {
    name: 'newsletter',
    channel: 'email',
    body: 'Body',
  };

  it('accepts a valid headers map with List-Unsubscribe', () => {
    const result = createTemplateSchema.safeParse({
      ...valid,
      headers: {
        'List-Unsubscribe': '<{{unsub_url}}>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headers).toEqual({
        'List-Unsubscribe': '<{{unsub_url}}>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      });
    }
  });

  it('accepts a payload without headers', () => {
    const result = createTemplateSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('accepts headers = null (clears headers)', () => {
    const result = createTemplateSchema.safeParse({ ...valid, headers: null });
    expect(result.success).toBe(true);
  });

  it('rejects forbidden header name Content-Type (Resend manages it)', () => {
    const result = createTemplateSchema.safeParse({
      ...valid,
      headers: { 'Content-Type': 'text/html' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(' ');
      expect(msg).toMatch(/Content-Type/i);
      expect(msg).toMatch(/reserved/i);
    }
  });

  it('rejects malformed header name with space (violates RFC-822 regex)', () => {
    const result = createTemplateSchema.safeParse({
      ...valid,
      headers: { 'X-Bad Header': 'val' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects forbidden header name From (case-insensitive match)', () => {
    const result = createTemplateSchema.safeParse({
      ...valid,
      headers: { 'From': 'x@y.com' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(' ');
      expect(msg).toMatch(/From/i);
      expect(msg).toMatch(/reserved/i);
    }
  });

  it('rejects empty header value', () => {
    const result = createTemplateSchema.safeParse({
      ...valid,
      headers: { 'X-Custom': '' },
    });
    expect(result.success).toBe(false);
  });
});

describe('updateTemplateSchema — headers', () => {
  it('accepts headers on update', () => {
    const result = updateTemplateSchema.safeParse({
      headers: { 'X-Client-Id': '{{client_id}}' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts headers = null on update (clears headers)', () => {
    const result = updateTemplateSchema.safeParse({ headers: null });
    expect(result.success).toBe(true);
  });

  it('rejects forbidden header name on update', () => {
    const result = updateTemplateSchema.safeParse({
      headers: { 'Subject': 'override attempt' },
    });
    expect(result.success).toBe(false);
  });
});

// Phase 7 7b — Recipient validation Zod refinement on rule-create.
// Only enforces shape when `recipient_type === 'static'`. Payload-path
// recipients (`event_field`) and `role`-typed recipients can't be
// validated at create time.
describe('createRuleSchema — static recipient validation', () => {
  const baseTemplate = '00000000-0000-0000-0000-000000000000';

  it('accepts a valid static email when channel=email', () => {
    const result = createRuleSchema.safeParse({
      event_type: 'order.completed',
      channel: 'email',
      template_id: baseTemplate,
      recipient_type: 'static',
      recipient_value: 'admin@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-email static recipient when channel=email', () => {
    const result = createRuleSchema.safeParse({
      event_type: 'order.completed',
      channel: 'email',
      template_id: baseTemplate,
      recipient_type: 'static',
      recipient_value: 'not-an-email',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.issues.map((i) => i.message).join(' ');
      expect(msg).toMatch(/email/i);
    }
  });

  it('accepts a payload-path recipient (event_field) for channel=email even if not email-shaped', () => {
    const result = createRuleSchema.safeParse({
      event_type: 'order.completed',
      channel: 'email',
      template_id: baseTemplate,
      recipient_type: 'event_field',
      recipient_value: 'recipient.id',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a static numeric chat_id for channel=telegram', () => {
    const result = createRuleSchema.safeParse({
      event_type: 'alert.triggered',
      channel: 'telegram',
      template_id: baseTemplate,
      recipient_type: 'static',
      recipient_value: '123456789',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a static @username for channel=telegram', () => {
    const result = createRuleSchema.safeParse({
      event_type: 'alert.triggered',
      channel: 'telegram',
      template_id: baseTemplate,
      recipient_type: 'static',
      recipient_value: '@kingsley_bot',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an obviously invalid telegram static recipient', () => {
    const result = createRuleSchema.safeParse({
      event_type: 'alert.triggered',
      channel: 'telegram',
      template_id: baseTemplate,
      recipient_type: 'static',
      recipient_value: 'not a phone or chat id with spaces',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a static phone-like value for channel=sms', () => {
    const result = createRuleSchema.safeParse({
      event_type: 'order.shipped',
      channel: 'sms',
      template_id: baseTemplate,
      recipient_type: 'static',
      recipient_value: '+15551234567',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-phone static value for channel=sms', () => {
    const result = createRuleSchema.safeParse({
      event_type: 'order.shipped',
      channel: 'sms',
      template_id: baseTemplate,
      recipient_type: 'static',
      recipient_value: 'lol',
    });
    expect(result.success).toBe(false);
  });
});

// Phase 7 7b — Top-level tenant config schema validation.
// Composes channels.email, channels.telegram, and rate_limits.
describe('tenantChannelConfigSchema — full top-level validation', () => {
  it('accepts a config with email + telegram + rate_limits', () => {
    const result = tenantChannelConfigSchema.safeParse({
      channels: {
        email: {
          apiKey: 're_test',
          from: 'noreply@example.com',
          replyTo: 'support@example.com',
          sandbox: true,
          fromDomains: [{ domain: 'example.com', default: true }],
        },
        telegram: {
          botToken: '123:ABC',
          botUsername: 'TestBot',
        },
      },
      rate_limits: {
        events_per_minute: 200,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects rate_limits.events_per_minute over 1000', () => {
    const result = tenantChannelConfigSchema.safeParse({
      rate_limits: { events_per_minute: 9999 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects rate_limits.events_per_minute under 1', () => {
    const result = tenantChannelConfigSchema.safeParse({
      rate_limits: { events_per_minute: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed email config (missing apiKey)', () => {
    const result = tenantChannelConfigSchema.safeParse({
      channels: { email: { from: 'noreply@example.com' } },
    });
    expect(result.success).toBe(false);
  });

  it('passes through unknown top-level keys (legacy compat)', () => {
    // Existing tenants may store ad-hoc fields like dedup_window or
    // legacy keys; the validator only enforces shapes on known sections.
    const result = tenantChannelConfigSchema.safeParse({
      channels: {},
      dedup_window: 30,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty config object', () => {
    const result = tenantChannelConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects malformed telegram config (missing botToken)', () => {
    const result = tenantChannelConfigSchema.safeParse({
      channels: { telegram: { botUsername: 'x' } },
    });
    expect(result.success).toBe(false);
  });
});
