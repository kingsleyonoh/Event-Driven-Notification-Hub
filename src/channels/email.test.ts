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
