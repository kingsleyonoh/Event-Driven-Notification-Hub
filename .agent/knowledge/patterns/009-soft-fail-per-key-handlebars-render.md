# Pattern 009: Per-Key Soft-Fail Handlebars Rendering

## Problem

When a tenant supplies a JSONB map of `{ key: handlebarsTemplateString }` (e.g. `templates.headers` for RFC 8058 `List-Unsubscribe`), some entries can fail to render at runtime:

- Missing payload field (`{{undefined_field}}` resolves to `""` — silent, not an error)
- Missing partial / helper (`{{> nonexistent}}` — throws)
- Lambda / sub-expression error
- Type-coercion failure on a custom helper

If the renderer aborts on first throw, ALL entries are lost — including the ones that would have rendered fine. For optional/additive surfaces like email headers, that's an over-reaction. The email is still useful without one header.

## Solution

Iterate over `Object.entries(map)`, render each value independently inside a try/catch, accumulate successful renders into a fresh map, log a structured `warn` on per-entry throw, then attach the accumulated map to the dispatch config only if it ended up non-empty.

```ts
let renderedHeaders: Record<string, string> | undefined;
if (rule.channel === 'email' && tmpl.headers && Object.keys(tmpl.headers).length > 0) {
  const out: Record<string, string> = {};
  for (const [name, valueTemplate] of Object.entries(tmpl.headers)) {
    try {
      out[name] = renderTemplate(valueTemplate, payload);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'header render failed';
      logger.warn(
        { eventId, recipient, notificationId: notif.id, headerName: name, error: errMsg },
        'header value render failed — skipping this header, continuing dispatch',
      );
    }
  }
  if (Object.keys(out).length > 0) {
    renderedHeaders = out;
  }
}
```

## When to Use

- The map keys are **independent** — losing one doesn't invalidate the others (headers, metadata, telemetry tags).
- The surface is **additive / optional** — the parent operation succeeds without the failed entry (the email still ships).
- The PRD authorizes soft-fail (this is NOT a SILENT_WORKAROUND — it's an explicit spec choice; cite the PRD section in code comments / journal).

## When NOT to Use

- Map entries are **interdependent** (e.g. attachment fetches where one missing PDF invalidates the receipt set) → fail-the-notification, like `src/processor/pipeline.ts` H1 attachments path.
- Surface is **load-bearing** (subject, body, primary recipient address) → fail loudly.
- Tenant SLA requires "all-or-nothing" delivery → fail the notification, surface the error.

## Observability Contract

Every soft-fail MUST emit a `warn`-level log with at minimum:
- `notificationId` (so operators can join to the audit row)
- The map key that failed (`headerName`, `metadataKey`, etc.)
- The error message

This makes the soft-fail visible and auditable — it's not a silent skip.

## Distinguishing from Silent Workaround (CRITICAL)

This pattern is NOT a Silent Workaround (see `yolo-honesty-checks.md` §8) because:

1. **PRD-authorized.** The Hub PRD §13 Phase 7 H3 explicitly says: "if any render fails, treat as soft-fail (skip that header, log warning, continue)."
2. **Observable.** Each skip emits a structured warn — operators can grep for it.
3. **No literal hardcoding.** The fallback is "omit the entry," not "substitute a tenant-identity literal."

If you find yourself wanting to silently swap a failed render for a hardcoded value (a tenant's literal name, address, etc.), STOP — that IS a SILENT_WORKAROUND violation. The valid soft-fail responses are: omit, render `""`, or fail-the-parent.

## Discovered In

- Phase 7 batch 010 — H3 custom email headers (RFC 8058 `List-Unsubscribe` for Gmail one-click unsubscribe).

## Affects

- Any per-tenant JSONB map of Handlebars templates rendered against per-event payloads.
- Future candidates: H4 webhook callback metadata, per-tenant URL templates, future H9 multi-language fallback per-field rendering.
