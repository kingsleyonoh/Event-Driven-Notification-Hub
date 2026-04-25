-- Phase 7 H10: Per-tenant suppression list.
-- A pre-dispatch guard prevents email/sms/telegram from being sent to recipients
-- a tenant has marked as suppressed (hard bounces, complaints, manual blocks,
-- unsubscribes). `recipient` is stored lowercased and queried case-insensitively.
-- `expires_at` NULL = permanent suppression; non-NULL means "ignore once past this".
CREATE TABLE "tenant_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" text NOT NULL,
	"recipient" text NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_suppressions" ADD CONSTRAINT "tenant_suppressions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_suppressions" ADD CONSTRAINT "tenant_suppressions_tenant_recipient_unique" UNIQUE("tenant_id","recipient");--> statement-breakpoint
CREATE INDEX "tenant_suppressions_lookup_idx" ON "tenant_suppressions" USING btree ("tenant_id","recipient","expires_at");
