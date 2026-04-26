-- Phase 7 7b: Tenant pass-through metadata on notifications.
-- Pipeline copies `event.payload._metadata` (when present) to this column
-- so tenants can correlate notifications back to their own request_id /
-- trace_id / job_id surfaces. Reserved underscore-prefix convention
-- matches `_reply_to` from H2.
ALTER TABLE "notifications" ADD COLUMN "metadata" jsonb DEFAULT NULL;
