# Zod v4 Validation at the Route Boundary

## Purpose

Validate ALL untrusted input (body / query / params) at the API boundary using Zod schemas, then route validation errors through `AppError` for a uniform response shape.

## When to use

- Every route that accepts a request body, query params, or URL params.

## How it works

- Zod schemas live centrally in `src/api/schemas.ts` (one schema per route shape).
- Inside the handler:
  ```ts
  const body = createRuleSchema.parse(request.body);
  ```
  On failure, Zod throws `ZodError`, which the global error handler maps to `ValidationError` (HTTP 400) with `details: zodError.issues`.
- Route schemas are typed via `z.infer<typeof schema>` — no manual interface duplication.

## Cross-references

- Foundation: `.agent/knowledge/foundation/api-schemas.md`
- Pattern: `.agent/knowledge/patterns/002-app-error-response.md`
