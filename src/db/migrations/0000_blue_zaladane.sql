CREATE TABLE "digest_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"user_id" text NOT NULL,
	"notification_id" uuid NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "heartbeats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"source_name" text NOT NULL,
	"interval_minutes" integer DEFAULT 240 NOT NULL,
	"last_seen_at" timestamp,
	"alerted_at" timestamp,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "heartbeats_tenant_source_unique" UNIQUE("tenant_id","source_name")
);
--> statement-breakpoint
CREATE TABLE "notification_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"event_type" text NOT NULL,
	"channel" text NOT NULL,
	"template_id" uuid NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_value" text NOT NULL,
	"urgency" text DEFAULT 'normal' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rules_tenant_event_channel_recipient_unique" UNIQUE("tenant_id","event_type","channel","recipient_type","recipient_value")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"rule_id" uuid,
	"event_type" text NOT NULL,
	"event_id" text NOT NULL,
	"recipient" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body_preview" text,
	"payload" jsonb,
	"status" text NOT NULL,
	"skip_reason" text,
	"error_message" text,
	"delivered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"name" text NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "templates_tenant_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"api_key" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text DEFAULT 'default' NOT NULL,
	"user_id" text NOT NULL,
	"email" text,
	"phone" text,
	"opt_out" jsonb DEFAULT '{}'::jsonb,
	"quiet_hours" jsonb DEFAULT '{}'::jsonb,
	"digest_mode" boolean DEFAULT false NOT NULL,
	"digest_schedule" text DEFAULT 'daily' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "preferences_tenant_user_unique" UNIQUE("tenant_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "digest_queue" ADD CONSTRAINT "digest_queue_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeats" ADD CONSTRAINT "heartbeats_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_rule_id_notification_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."notification_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "digest_tenant_user_sent_idx" ON "digest_queue" USING btree ("tenant_id","user_id","sent");--> statement-breakpoint
CREATE INDEX "digest_scheduled_for_idx" ON "digest_queue" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "heartbeats_enabled_last_seen_idx" ON "heartbeats" USING btree ("enabled","last_seen_at");--> statement-breakpoint
CREATE INDEX "rules_tenant_event_idx" ON "notification_rules" USING btree ("tenant_id","event_type");--> statement-breakpoint
CREATE INDEX "rules_channel_idx" ON "notification_rules" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "notifications_dedup_idx" ON "notifications" USING btree ("tenant_id","event_id","recipient","channel");--> statement-breakpoint
CREATE INDEX "notifications_tenant_status_idx" ON "notifications" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "notifications_tenant_recipient_created_idx" ON "notifications" USING btree ("tenant_id","recipient","created_at");