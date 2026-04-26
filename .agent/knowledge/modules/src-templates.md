# src/templates/

## Purpose

Compile and render Handlebars templates from the `templates` table for each channel.

## Key files

- `src/templates/renderer.ts` — Compiles a template body once (cached by `template_id` + version), renders against an immutable per-notification payload snapshot.

## Dependencies

- Upstream: `handlebars`, `src/lib/`.

## Tests

- `src/templates/renderer.test.ts` — covers strict undefined handling (missing tokens throw), multi-tenant fixture rendering, partial rendering.

## Cross-references

- Rule: `CODING_STANDARDS_DOMAIN.md` — Multi-Tenant Config-Driven Surfaces (no hardcoded tenant literals, strict mode on).
