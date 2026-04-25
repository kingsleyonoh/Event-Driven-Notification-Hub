import { describe, it, expect } from 'vitest';
import {
  channelEnum,
  upsertPreferencesSchema,
  createTemplateSchema,
  updateTemplateSchema,
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
