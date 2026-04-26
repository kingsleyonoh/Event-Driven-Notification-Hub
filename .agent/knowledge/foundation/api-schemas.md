# Zod Validation Schemas

## What it establishes

All request validation schemas live in one file. Routes import + `parse()` to validate input — Zod errors flow through the global error handler as `ValidationError`.

## Files

- `src/api/schemas.ts` — Zod v4 schemas for every route (createRule, updateRule, listNotifications, createTenant, etc.).

## When to read this

Before adding any new route. Before changing an existing route's request shape.

## Contract

- One schema per route shape.
- Use `z.infer<typeof schema>` to get the TS type — never duplicate as a separate `interface`.
- Required fields use `.min(1)`; optional use `.optional()`; enums use `z.enum([...])` matching the Drizzle schema.
- Schemas are referenced by both runtime `parse()` AND OpenAPI generation (when wired).
