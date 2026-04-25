import { z } from 'zod/v4';

// ─── Shared enums ────────────────────────────────────────────────────

export const channelEnum = z.enum(['email', 'sms', 'in_app', 'telegram']);
export const urgencyEnum = z.enum(['low', 'normal', 'high', 'critical']);
export const recipientTypeEnum = z.enum(['event_field', 'static', 'role']);
export const digestScheduleEnum = z.enum(['hourly', 'daily', 'weekly']);
export const notificationStatusEnum = z.enum([
  'pending', 'sent', 'failed', 'queued_digest', 'skipped', 'held',
]);

// ─── Tenant Channel Config ──────────────────────────────────────────

export const emailChannelConfigSchema = z.object({
  apiKey: z.string().min(1),
  from: z.string().min(1),
  replyTo: z.string().email().optional(),
});

export const telegramChannelConfigSchema = z.object({
  botToken: z.string().min(1),
  botUsername: z.string().min(1),
});

export const tenantChannelConfigSchema = z.object({
  channels: z.object({
    email: emailChannelConfigSchema.optional(),
    telegram: telegramChannelConfigSchema.optional(),
  }).optional(),
});

// ─── Rules ───────────────────────────────────────────────────────────

export const createRuleSchema = z.object({
  event_type: z.string().min(1),
  channel: channelEnum,
  template_id: z.string().uuid(),
  recipient_type: recipientTypeEnum,
  recipient_value: z.string().min(1),
  urgency: urgencyEnum.optional().default('normal'),
  enabled: z.boolean().optional().default(true),
});

export const updateRuleSchema = z.object({
  event_type: z.string().min(1).optional(),
  channel: channelEnum.optional(),
  template_id: z.string().uuid().optional(),
  recipient_type: recipientTypeEnum.optional(),
  recipient_value: z.string().min(1).optional(),
  urgency: urgencyEnum.optional(),
  enabled: z.boolean().optional(),
});

// ─── Templates ───────────────────────────────────────────────────────

// Per-attachment config — strict so unknown keys are rejected
export const attachmentConfigEntrySchema = z
  .object({
    filename_template: z.string().min(1),
    url_field: z.string().min(1),
  })
  .strict();

export const attachmentsConfigSchema = z
  .array(attachmentConfigEntrySchema)
  .nullable()
  .optional();

export const createTemplateSchema = z.object({
  name: z.string().min(1),
  channel: channelEnum,
  subject: z.string().optional(),
  body: z.string().min(1),
  attachments_config: attachmentsConfigSchema,
  reply_to: z.string().email().nullable().optional(),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  channel: channelEnum.optional(),
  subject: z.string().optional(),
  body: z.string().min(1).optional(),
  attachments_config: attachmentsConfigSchema,
  reply_to: z.string().email().nullable().optional(),
});

export const previewTemplateSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
});

// ─── Preferences ─────────────────────────────────────────────────────

export const upsertPreferencesSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().min(1).optional(),
  telegram_chat_id: z.string().optional(),
  opt_out: z.record(z.string(), z.array(z.string())).optional(),
  quiet_hours: z.object({
    start: z.string(),
    end: z.string(),
    timezone: z.string(),
  }).optional(),
  digest_mode: z.boolean().optional(),
  digest_schedule: digestScheduleEnum.optional(),
});

// ─── Events ──────────────────────────────────────────────────────────

export const publishEventSchema = z.object({
  event_type: z.string().min(1),
  event_id: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

// ─── Admin Tenants ───────────────────────────────────────────────────

export const createTenantSchema = z.object({
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const updateTenantSchema = z.object({
  name: z.string().min(1).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

// ─── Heartbeats ─────────────────────────────────────────────────────

export const upsertHeartbeatSchema = z.object({
  source_name: z.string().min(1),
  interval_minutes: z.number().int().min(1).optional(),
});

// ─── Pagination ──────────────────────────────────────────────────────

export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  status: notificationStatusEnum.optional(),
  channel: channelEnum.optional(),
  created_after: z.string().datetime().optional(),
  created_before: z.string().datetime().optional(),
  userId: z.string().optional(),
});
