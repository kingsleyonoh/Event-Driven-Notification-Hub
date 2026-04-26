import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import {
  createTestTenant, createTestTemplate, createTestRule, cleanupTestData,
} from '../test/factories.js';
import { notifications } from '../db/schema.js';
import { processNotification } from './pipeline.js';

// Mock Resend at the package level — captures all email send calls
const mockResendSend = vi.fn();

vi.mock('resend', () => {
  return {
    Resend: class MockResend {
      emails = { send: mockResendSend };
    },
  };
});

let tenant: Awaited<ReturnType<typeof createTestTenant>>;
let template: Awaited<ReturnType<typeof createTestTemplate>>;
let rule: Awaited<ReturnType<typeof createTestRule>>;

beforeAll(async () => {
  tenant = await createTestTenant(db);
  template = await createTestTemplate(db, tenant.id, {
    subject: 'Invoice {{invoice_number}}',
    body: 'Your invoice {{invoice_number}} is ready.',
    attachmentsConfig: [
      { filename_template: '{{invoice_number}}.pdf', url_field: 'pdf_url' },
    ],
  });
  rule = await createTestRule(db, tenant.id, template.id, {
    eventType: 'invoice.issued',
    channel: 'email',
    recipientType: 'static',
    recipientValue: 'customer@example.com',
  });
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

beforeEach(() => {
  mockResendSend.mockReset();
  // Default: send succeeds (tests that need failure override this)
  mockResendSend.mockResolvedValue({ data: { id: 'msg-default' }, error: null });
});

function makeEvent(overrides: Partial<{ event_id: string; payload: Record<string, unknown> }> = {}) {
  return {
    tenant_id: tenant.id,
    event_type: 'invoice.issued',
    event_id: overrides.event_id ?? `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    payload: overrides.payload ?? {
      invoice_number: '1234',
      pdf_url: 'https://signed.example.com/invoice-1234.pdf',
    },
    timestamp: new Date().toISOString(),
  };
}

describe('processNotification — attachments', () => {
  it('sends email with attachments when template has attachments_config and url fetch succeeds', async () => {
    // Stub global fetch to return a fake PDF (binary bytes)
    const fakePdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
    const expectedBase64 = Buffer.from(fakePdfBytes).toString('base64');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => fakePdfBytes.buffer.slice(
        fakePdfBytes.byteOffset,
        fakePdfBytes.byteOffset + fakePdfBytes.byteLength,
      ),
    });
    vi.stubGlobal('fetch', fetchMock);

    const event = makeEvent({ event_id: `success-${Date.now()}` });

    await processNotification(db, event, rule, 'customer@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: {
        channels: {
          email: { apiKey: 're_test', from: 'noreply@test.com' },
        },
      },
    });

    // Verify the URL was fetched
    expect(fetchMock).toHaveBeenCalledWith(
      'https://signed.example.com/invoice-1234.pdf',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // Verify Resend received attachments in the right shape
    expect(mockResendSend).toHaveBeenCalledTimes(1);
    const sendArgs = mockResendSend.mock.calls[0][0];
    expect(sendArgs.attachments).toEqual([
      { filename: '1234.pdf', content: expectedBase64 },
    ]);

    // Verify notification status
    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));
    expect(notif.status).toBe('sent');

    vi.unstubAllGlobals();
  });

  it('marks notification failed and does NOT send email when attachment URL returns 500', async () => {
    // fetch always returns 500 (will be retried once, then give up)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal('fetch', fetchMock);

    const event = makeEvent({ event_id: `fail-${Date.now()}` });

    await processNotification(db, event, rule, 'customer@example.com', {
      dedupWindowMinutes: 60,
      digestSchedule: 'daily',
      tenantConfig: {
        channels: {
          email: { apiKey: 're_test', from: 'noreply@test.com' },
        },
      },
    });

    // Resend was NEVER called
    expect(mockResendSend).not.toHaveBeenCalled();

    // Notification marked failed with attachment-related error message
    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));
    expect(notif).toBeDefined();
    expect(notif.status).toBe('failed');
    expect(notif.errorMessage).toBeTruthy();
    expect(notif.errorMessage!.toLowerCase()).toContain('attachment');

    vi.unstubAllGlobals();
  });
});
