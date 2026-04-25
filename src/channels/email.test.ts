import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail, type EmailConfig } from './email.js';

// Mock the resend package — third-party API with billing (allowed per mock policy)
const mockSend = vi.fn();

vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = { send: mockSend };
    },
  };
});

describe('sendEmail', () => {
  const config = { apiKey: 're_test_key', from: 'noreply@test.com' };

  beforeEach(() => {
    mockSend.mockReset();
  });

  it('returns success when Resend API responds successfully', async () => {
    mockSend.mockResolvedValue({ data: { id: 'msg-123' }, error: null });

    const result = await sendEmail('user@example.com', 'Hello', '<p>Body</p>', config);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(mockSend).toHaveBeenCalledWith({
      from: 'noreply@test.com',
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Body</p>',
    });
  });

  it('returns failure when Resend API returns an error response', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: 'Invalid recipient', name: 'validation_error' },
    });

    const result = await sendEmail('bad-email', 'Subject', 'Body', config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid recipient');
  });

  it('returns failure when Resend API throws (rate limit / network error)', async () => {
    mockSend.mockRejectedValue(new Error('Rate limit exceeded'));

    const result = await sendEmail('user@example.com', 'Subject', 'Body', config);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Rate limit exceeded');
  });

  it('sends email with empty subject when subject is null', async () => {
    mockSend.mockResolvedValue({ data: { id: 'msg-456' }, error: null });

    const result = await sendEmail('user@example.com', null, 'Body only', config);

    expect(result.success).toBe(true);
    expect(mockSend).toHaveBeenCalledWith({
      from: 'noreply@test.com',
      to: 'user@example.com',
      subject: '',
      html: 'Body only',
    });
  });

  it('forwards attachments to Resend when attachments are provided', async () => {
    mockSend.mockResolvedValue({ data: { id: 'msg-789' }, error: null });

    const configWithAttachments = {
      ...config,
      attachments: [
        { filename: 'invoice-1234.pdf', content: 'JVBERi0xLjQK' },
        { filename: 'receipt-1234.pdf', content: 'JVBERi0xLjUK' },
      ],
    };

    const result = await sendEmail(
      'user@example.com',
      'With attachments',
      '<p>See attached</p>',
      configWithAttachments,
    );

    expect(result.success).toBe(true);
    expect(mockSend).toHaveBeenCalledWith({
      from: 'noreply@test.com',
      to: 'user@example.com',
      subject: 'With attachments',
      html: '<p>See attached</p>',
      attachments: [
        { filename: 'invoice-1234.pdf', content: 'JVBERi0xLjQK' },
        { filename: 'receipt-1234.pdf', content: 'JVBERi0xLjUK' },
      ],
    });
  });

  it('does not include attachments key when attachments not provided', async () => {
    mockSend.mockResolvedValue({ data: { id: 'msg-no-att' }, error: null });

    await sendEmail('user@example.com', 'Plain', '<p>Body</p>', config);

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('attachments');
  });

  it('forwards headers to Resend when provided; omits when absent or empty', async () => {
    // Case 1: headers set on EmailConfig → Resend payload includes headers
    mockSend.mockResolvedValue({ data: { id: 'msg-h-1' }, error: null });

    const configWithHeaders: EmailConfig = {
      ...config,
      headers: {
        'List-Unsubscribe': '<https://x.com/u/abc>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    };

    await sendEmail(
      'user@example.com',
      'Newsletter',
      '<p>Body</p>',
      configWithHeaders,
    );

    expect(mockSend).toHaveBeenCalledWith({
      from: 'noreply@test.com',
      to: 'user@example.com',
      subject: 'Newsletter',
      html: '<p>Body</p>',
      headers: {
        'List-Unsubscribe': '<https://x.com/u/abc>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    // Case 2: headers absent → no headers key in payload
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: 'msg-h-2' }, error: null });

    await sendEmail('user@example.com', 'No headers', '<p>Body</p>', config);

    let callArgs = mockSend.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('headers');

    // Case 3: empty headers map → no headers key in payload
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: 'msg-h-3' }, error: null });

    await sendEmail(
      'user@example.com',
      'Empty headers',
      '<p>Body</p>',
      { ...config, headers: {} },
    );

    callArgs = mockSend.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('headers');
  });

  it('forwards both html and text to Resend when text param is provided (Phase 7 H8)', async () => {
    mockSend.mockResolvedValue({ data: { id: 'msg-text-1' }, error: null });

    const configWithText: EmailConfig = {
      ...config,
      text: 'Plain text body for non-HTML clients',
    };

    const result = await sendEmail(
      'user@example.com',
      'Plain fallback',
      '<p>HTML body</p>',
      configWithText,
    );

    expect(result.success).toBe(true);
    expect(mockSend).toHaveBeenCalledWith({
      from: 'noreply@test.com',
      to: 'user@example.com',
      subject: 'Plain fallback',
      html: '<p>HTML body</p>',
      text: 'Plain text body for non-HTML clients',
    });
  });

  it('does not include text key when text not provided or empty (Phase 7 H8)', async () => {
    // Case 1: text not provided
    mockSend.mockResolvedValue({ data: { id: 'msg-text-2' }, error: null });

    await sendEmail('user@example.com', 'No text', '<p>Body</p>', config);

    let callArgs = mockSend.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('text');

    // Case 2: empty string text → omitted
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: 'msg-text-3' }, error: null });

    await sendEmail(
      'user@example.com',
      'Empty text',
      '<p>Body</p>',
      { ...config, text: '' },
    );

    callArgs = mockSend.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('text');
  });

  it('forwards replyTo to Resend when set; omits when absent', async () => {
    // Case 1: replyTo set on EmailConfig → Resend call payload includes replyTo
    mockSend.mockResolvedValue({ data: { id: 'msg-rt-1' }, error: null });

    const configWithReplyTo: EmailConfig = {
      ...config,
      replyTo: 'support@x.com',
    };

    await sendEmail(
      'user@example.com',
      'Need help?',
      '<p>Hello</p>',
      configWithReplyTo,
    );

    expect(mockSend).toHaveBeenCalledWith({
      from: 'noreply@test.com',
      to: 'user@example.com',
      subject: 'Need help?',
      html: '<p>Hello</p>',
      replyTo: 'support@x.com',
    });

    // Case 2: replyTo absent on EmailConfig → call payload has no replyTo key
    mockSend.mockReset();
    mockSend.mockResolvedValue({ data: { id: 'msg-rt-2' }, error: null });

    await sendEmail('user@example.com', 'No reply-to', '<p>Body</p>', config);

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('replyTo');
  });
});
