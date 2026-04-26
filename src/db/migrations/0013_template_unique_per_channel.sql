-- Phase 7 7b — `__digest` template needs per-channel variants (email + telegram).
-- The H9 constraint was `(tenant_id, name, locale)` which blocked having both
-- an email and a telegram `__digest` for the same tenant + locale. Extending
-- to include channel.
ALTER TABLE templates DROP CONSTRAINT IF EXISTS templates_tenant_name_locale_unique;
ALTER TABLE templates ADD CONSTRAINT templates_tenant_name_locale_channel_unique UNIQUE (tenant_id, name, locale, channel);
