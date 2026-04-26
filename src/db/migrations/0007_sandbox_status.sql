-- Phase 7 H5: Sandbox mode per tenant
-- Adds 'sent_sandbox' as a valid value for notifications.status.
-- Uses DROP IF EXISTS so the migration is idempotent across environments
-- where no prior CHECK constraint existed (Drizzle's `text { enum: [...] }`
-- does not emit a Postgres CHECK by default).

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_status_check";--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_status_check"
  CHECK (status IN ('pending','sent','sent_sandbox','failed','queued_digest','skipped','held'));
