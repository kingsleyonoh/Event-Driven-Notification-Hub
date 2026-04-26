-- Phase 7 H6: Multiple verified Resend domains per tenant.
-- Adds a per-rule sending-domain override. Tenants list verified domains in
-- `tenants.config.channels.email.fromDomains` (one entry must have
-- `default: true`); rules can opt into a specific domain via
-- `from_domain_override`. Dispatcher resolves: rule override → tenant default →
-- first fromDomains entry → legacy single-domain `from`.
ALTER TABLE "notification_rules" ADD COLUMN "from_domain_override" text;
