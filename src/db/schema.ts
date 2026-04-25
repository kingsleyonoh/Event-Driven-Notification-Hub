import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  jsonb,
  integer,
  index,
  unique,
} from 'drizzle-orm/pg-core';

// ─── Tenants (Section 4.6) ──────────────────────────────────────────

export const tenants = pgTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  apiKey: text('api_key').notNull().unique(),
  deliveryCallbackSecret: text('delivery_callback_secret'),
  config: jsonb('config').default({}).$type<Record<string, unknown>>(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Templates (Section 4.2) ────────────────────────────────────────
// Defined before notification_rules because rules FK → templates

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: text('tenant_id').notNull().default('default'),
    name: text('name').notNull(),
    channel: text('channel', { enum: ['email', 'sms', 'in_app', 'telegram'] }).notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    bodyText: text('body_text'),
    replyTo: text('reply_to'),
    attachmentsConfig: jsonb('attachments_config').$type<
      Array<{ filename_template: string; url_field: string }>
    >(),
    headers: jsonb('headers').$type<Record<string, string>>(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('templates_tenant_name_unique').on(table.tenantId, table.name),
  ],
);

// ─── Notification Rules (Section 4.1) ───────────────────────────────

export const notificationRules = pgTable(
  'notification_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: text('tenant_id').notNull().default('default'),
    eventType: text('event_type').notNull(),
    channel: text('channel', { enum: ['email', 'sms', 'in_app', 'telegram'] }).notNull(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'restrict' }),
    recipientType: text('recipient_type', {
      enum: ['event_field', 'static', 'role'],
    }).notNull(),
    recipientValue: text('recipient_value').notNull(),
    urgency: text('urgency', {
      enum: ['low', 'normal', 'high', 'critical'],
    })
      .default('normal')
      .notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('rules_tenant_event_idx').on(table.tenantId, table.eventType),
    index('rules_channel_idx').on(table.channel),
    unique('rules_tenant_event_channel_recipient_unique').on(
      table.tenantId,
      table.eventType,
      table.channel,
      table.recipientType,
      table.recipientValue,
    ),
  ],
);

// ─── User Preferences (Section 4.3) ─────────────────────────────────

export const userPreferences = pgTable(
  'user_preferences',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: text('tenant_id').notNull().default('default'),
    userId: text('user_id').notNull(),
    email: text('email'),
    phone: text('phone'),
    telegramChatId: text('telegram_chat_id'),
    telegramLinkToken: text('telegram_link_token'),
    optOut: jsonb('opt_out').default({}).$type<Record<string, string[]>>(),
    quietHours: jsonb('quiet_hours')
      .default({})
      .$type<{ start?: string; end?: string; timezone?: string }>(),
    digestMode: boolean('digest_mode').default(false).notNull(),
    digestSchedule: text('digest_schedule', {
      enum: ['hourly', 'daily', 'weekly'],
    })
      .default('daily')
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('preferences_tenant_user_unique').on(table.tenantId, table.userId),
  ],
);

// ─── Notifications (Section 4.4) ────────────────────────────────────

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: text('tenant_id').notNull().default('default'),
    ruleId: uuid('rule_id').references(() => notificationRules.id, {
      onDelete: 'set null',
    }),
    eventType: text('event_type').notNull(),
    eventId: text('event_id').notNull(),
    recipient: text('recipient').notNull(),
    channel: text('channel', { enum: ['email', 'sms', 'in_app', 'telegram'] }).notNull(),
    subject: text('subject'),
    bodyPreview: text('body_preview'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    status: text('status', {
      enum: ['pending', 'sent', 'sent_sandbox', 'failed', 'queued_digest', 'skipped', 'held'],
    }).notNull(),
    skipReason: text('skip_reason'),
    errorMessage: text('error_message'),
    deliveredAt: timestamp('delivered_at'),
    bounceType: text('bounce_type'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('notifications_dedup_idx').on(
      table.tenantId,
      table.eventId,
      table.recipient,
      table.channel,
    ),
    index('notifications_tenant_status_idx').on(table.tenantId, table.status),
    index('notifications_tenant_recipient_created_idx').on(
      table.tenantId,
      table.recipient,
      table.createdAt,
    ),
  ],
);

// ─── Digest Queue (Section 4.5) ─────────────────────────────────────

export const digestQueue = pgTable(
  'digest_queue',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: text('tenant_id').notNull().default('default'),
    userId: text('user_id').notNull(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    scheduledFor: timestamp('scheduled_for').notNull(),
    sent: boolean('sent').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('digest_tenant_user_sent_idx').on(
      table.tenantId,
      table.userId,
      table.sent,
    ),
    index('digest_scheduled_for_idx').on(table.scheduledFor),
  ],
);

// ─── Email Delivery Events (Section 7 H4) ───────────────────────────
// Persists Resend webhook events (delivered/bounced/complained/etc).
// `notification_id` is nullable because the webhook may arrive before
// correlation succeeds (e.g. metadata stripped) — we still keep the
// event for audit. `callback_status_code` is nullable until the tenant
// callback fires.

export const emailDeliveryEvents = pgTable(
  'email_delivery_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    notificationId: uuid('notification_id').references(() => notifications.id, {
      onDelete: 'set null',
    }),
    resendEmailId: text('resend_email_id').notNull(),
    eventType: text('event_type').notNull(),
    rawPayload: jsonb('raw_payload').$type<Record<string, unknown>>().notNull(),
    callbackStatusCode: integer('callback_status_code'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('email_delivery_events_tenant_created_idx').on(
      table.tenantId,
      table.createdAt.desc(),
    ),
    index('email_delivery_events_resend_email_id_idx').on(table.resendEmailId),
  ],
);

// ─── Heartbeats (Section 4.7) ───────────────────────────────────────

export const heartbeats = pgTable(
  'heartbeats',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    sourceName: text('source_name').notNull(),
    intervalMinutes: integer('interval_minutes').notNull().default(240),
    lastSeenAt: timestamp('last_seen_at'),
    alertedAt: timestamp('alerted_at'),
    enabled: boolean('enabled').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('heartbeats_tenant_source_unique').on(
      table.tenantId,
      table.sourceName,
    ),
    index('heartbeats_enabled_last_seen_idx').on(
      table.enabled,
      table.lastSeenAt,
    ),
  ],
);
