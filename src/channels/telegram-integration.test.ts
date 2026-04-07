import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../test/setup.js';
import {
  createTestTenant, createTestTemplate, createTestRule,
  createTestPreferences, cleanupTestData,
} from '../test/factories.js';
import { notifications } from '../db/schema.js';
import { processNotification } from '../processor/pipeline.js';
import type { KafkaEvent } from '../consumer/kafka.js';

// Mock telegram sendMessage — third-party API
vi.mock('./telegram.js', () => ({
  sendTelegram: vi.fn().mockResolvedValue({ success: true }),
}));
// Mock other channels we don't care about in this test
vi.mock('./email.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('./sms.js', () => ({
  sendSms: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('./in-app.js', () => ({
  sendInApp: vi.fn().mockResolvedValue({ success: true }),
}));

let tenantWithTelegram: Awaited<ReturnType<typeof createTestTenant>>;
let tenantWithoutTelegram: Awaited<ReturnType<typeof createTestTenant>>;

const pipelineConfig = { dedupWindowMinutes: 60, digestSchedule: 'daily' as const };

beforeAll(async () => {
  tenantWithTelegram = await createTestTenant(db, {
    config: {
      channels: {
        telegram: { botToken: 'bot123:INT-TEST', botUsername: 'int_test_bot' },
      },
    },
  });

  tenantWithoutTelegram = await createTestTenant(db);
});

afterAll(async () => {
  await cleanupTestData(db, tenantWithTelegram.id);
  await cleanupTestData(db, tenantWithoutTelegram.id);
  await sql.end();
});

describe('E2E: Telegram notification flow', () => {
  it('tenant with telegram config -> event -> telegram notification sent', async () => {
    const { sendTelegram } = await import('./telegram.js');
    vi.mocked(sendTelegram).mockClear();

    const tmpl = await createTestTemplate(db, tenantWithTelegram.id, {
      channel: 'telegram',
      subject: 'Alert: {{title}}',
      body: 'Details: {{message}}',
    });

    const rule = await createTestRule(db, tenantWithTelegram.id, tmpl.id, {
      eventType: 'alert.triggered',
      channel: 'telegram',
      recipientType: 'event_field',
      recipientValue: 'userId',
    });

    await createTestPreferences(db, tenantWithTelegram.id, 'tg-e2e-user', {
      telegramChatId: '77889900',
    });

    const event: KafkaEvent = {
      tenant_id: tenantWithTelegram.id,
      event_type: 'alert.triggered',
      event_id: `tg-e2e-${Date.now()}-1`,
      payload: { title: 'Server Down', message: 'DB connection lost', userId: 'tg-e2e-user' },
      timestamp: new Date().toISOString(),
    };

    await processNotification(db, event, rule, 'tg-e2e-user', {
      ...pipelineConfig,
      tenantConfig: tenantWithTelegram.config,
    });

    // Verify notification was created and marked sent
    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif).toBeDefined();
    expect(notif.status).toBe('sent');
    expect(notif.channel).toBe('telegram');
    expect(notif.subject).toContain('Server Down');

    // Verify sendTelegram was called with correct args
    expect(sendTelegram).toHaveBeenCalledWith(
      '77889900',
      'Alert: Server Down',
      'Details: DB connection lost',
      { botToken: 'bot123:INT-TEST', botUsername: 'int_test_bot' },
    );
  });

  it('tenant without telegram config -> telegram dispatch fails gracefully', async () => {
    const { sendTelegram } = await import('./telegram.js');
    vi.mocked(sendTelegram).mockClear();

    const tmpl = await createTestTemplate(db, tenantWithoutTelegram.id, {
      channel: 'telegram',
      subject: 'Telegram Alert',
      body: 'Should fail gracefully',
    });

    const rule = await createTestRule(db, tenantWithoutTelegram.id, tmpl.id, {
      eventType: 'alert.no-config',
      channel: 'telegram',
      recipientType: 'static',
      recipientValue: '12345678',
    });

    const event: KafkaEvent = {
      tenant_id: tenantWithoutTelegram.id,
      event_type: 'alert.no-config',
      event_id: `tg-noconfig-${Date.now()}`,
      payload: {},
      timestamp: new Date().toISOString(),
    };

    await processNotification(db, event, rule, '12345678', {
      ...pipelineConfig,
      tenantConfig: tenantWithoutTelegram.config,
    });

    // Verify notification was created with failed status
    const [notif] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.eventId, event.event_id));

    expect(notif).toBeDefined();
    expect(notif.status).toBe('failed');
    expect(notif.errorMessage).toContain('no telegram config');

    // sendTelegram should NOT have been called
    expect(sendTelegram).not.toHaveBeenCalled();
  });
});
