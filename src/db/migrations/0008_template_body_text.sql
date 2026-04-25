-- Phase 7 H8: Plain-text email body fallback
-- Adds an optional `body_text` column to templates so tenants can supply a
-- plain-text alternative alongside the HTML `body`. The pipeline renders both
-- and forwards the rendered text to Resend's `text` field. When NULL, Resend
-- auto-generates a plain-text representation from the HTML body.
ALTER TABLE "templates" ADD COLUMN "body_text" text;
