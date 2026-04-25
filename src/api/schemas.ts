import { z } from 'zod/v4';

// ─── Shared enums ────────────────────────────────────────────────────

export const channelEnum = z.enum(['email', 'sms', 'in_app', 'telegram']);
export const urgencyEnum = z.enum(['low', 'normal', 'high', 'critical']);
export const recipientTypeEnum = z.enum(['event_field', 'static', 'role']);
export const digestScheduleEnum = z.enum(['hourly', 'daily', 'weekly']);
export const notificationStatusEnum = z.enum([
  'pending', 'sent', 'sent_sandbox', 'failed', 'queued_digest', 'skipped', 'held',
]);

// ─── Tenant Channel Config ──────────────────────────────────────────

export const emailChannelConfigSchema = z.object({
  apiKey: z.string().min(1),
  from: z.string().min(1),
  replyTo: z.string().email().optional(),
  // Phase 7 H4 — tenant-supplied URL that the Hub POSTs delivery
  // callbacks to (HMAC-signed via `tenants.delivery_callback_secret`).
  deliveryCallbackUrl: z.string().url().optional(),
  // Phase 7 H5 — when true, the Hub logs outgoing email at info level
  // and skips the Resend send. Notifications land as `sent_sandbox`.
  // Default behavior when the field is absent is equivalent to `false`
  // (the email branch checks `config.sandbox === true` strictly), so we
  // leave it undefined-when-omitted rather than injecting `false` — that
  // keeps the resolved config minimal and avoids polluting downstream
  // equality assertions in tests.
  sandbox: z.boolean().optional(),
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

// ─── Custom email headers (RFC 8058 List-Unsubscribe support) ───────
//
// Header names must match RFC-822 token (`A-Z`, `a-z`, `0-9`, `-`).
// Values are Handlebars template strings (rendered per-event).
// Reserved names that Resend manages — overriding could break delivery.
const RESERVED_HEADER_NAMES = ['content-type', 'from', 'to', 'subject'] as const;
const HEADER_NAME_REGEX = /^[A-Za-z0-9-]+$/;

export const headersSchema = z
  .record(z.string().regex(HEADER_NAME_REGEX), z.string().min(1))
  .nullable()
  .optional()
  .superRefine((val, ctx) => {
    if (val == null) return;
    for (const name of Object.keys(val)) {
      if (RESERVED_HEADER_NAMES.includes(name.toLowerCase() as (typeof RESERVED_HEADER_NAMES)[number])) {
        ctx.addIssue({
          code: 'custom',
          message: `Header name '${name}' is reserved by Resend; cannot override`,
          path: [name],
        });
      }
    }
  });

export const createTemplateSchema = z.object({
  name: z.string().min(1),
  channel: channelEnum,
  subject: z.string().optional(),
  body: z.string().min(1),
  // Phase 7 H8 — optional plain-text body for non-HTML clients. When omitted,
  // Resend auto-generates a text alternative from the HTML body.
  body_text: z.string().nullable().optional(),
  attachments_config: attachmentsConfigSchema,
  reply_to: z.string().email().nullable().optional(),
  headers: headersSchema,
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  channel: channelEnum.optional(),
  subject: z.string().optional(),
  body: z.string().min(1).optional(),
  body_text: z.string().nullable().optional(),
  attachments_config: attachmentsConfigSchema,
  reply_to: z.string().email().nullable().optional(),
  headers: headersSchema,
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

// Phase 7 H7 — Per-tenant rate-limit overrides on `tenants.config.rate_limits`.
// Stored on the freeform `config` JSONB; surfaced via PATCH /api/admin/tenants/:id/rate-limit.
// Range 1–1000 enforced at the API boundary; the resolver caps defensively.
export const rateLimitsConfigSchema = z.object({
  events_per_minute: z.number().int().min(1).max(1000),
});

export const updateTenantRateLimitSchema = z.object({
  events_per_minute: z.number().int().min(1).max(1000),
});

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
