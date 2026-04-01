import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendEmail } from './email.js';

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

  it('sends email with undefined subject when subject is null', async () => {
    mockSend.mockResolvedValue({ data: { id: 'msg-456' }, error: null });

    const result = await sendEmail('user@example.com', null, 'Body only', config);

    expect(result.success).toBe(true);
    expect(mockSend).toHaveBeenCalledWith({
      from: 'noreply@test.com',
      to: 'user@example.com',
      subject: undefined,
      html: 'Body only',
    });
  });
});
