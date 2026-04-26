-- Phase 7 H9: Multi-language template variants
-- Adds a `locale` column to templates so tenants can author multiple language
-- variants of the same template name. The pipeline looks up
-- (tenant_id, name, event.payload.locale) first, falling back to
-- (tenant_id, name, 'en') on miss. Existing rows default to 'en'.
-- The unique constraint shifts from (tenant_id, name) to (tenant_id, name, locale)
-- so multiple locales can coexist for a single template name.
ALTER TABLE "templates" ADD COLUMN "locale" text NOT NULL DEFAULT 'en';--> statement-breakpoint
ALTER TABLE "templates" DROP CONSTRAINT "templates_tenant_name_unique";--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_tenant_name_locale_unique" UNIQUE ("tenant_id","name","locale");
