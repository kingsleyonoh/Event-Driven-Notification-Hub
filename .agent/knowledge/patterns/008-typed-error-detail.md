# Typed Structured-Detail Field on AppError Subclasses

## Purpose

Some channel/integration errors carry rich structured metadata (failed URL, retry count, reason code) that server-side code needs to read programmatically — but the existing `AppError.details: string[]` wire shape is fixed by the error response contract. The pattern: keep the wire shape, add a typed instance field on the subclass.

## When to use

- A new error subclass needs to carry typed metadata beyond a flat string array.
- Pipeline / dispatcher code must branch on the metadata (e.g., "if reason is SIZE_CAP_EXCEEDED, mark notification failed").
- Clients still need the existing `{ error: { code, message, details } }` wire format.

## How it works

- Subclass `AppError` with a `public readonly <domainDetails>: SomeShape` field on the instance.
- Constructor accepts the typed object, JSON.stringifies it, and passes `[json]` as the `details` array to `super()`.
- Server reads `err.<domainDetails>.field` directly — no parsing.
- Clients receive `details: [JSON_STRING]` via `toErrorResponse()` — backwards compatible.

## Example

```ts
// src/lib/errors.ts
export class AttachmentFetchError extends AppError {
  public readonly attachmentDetails: {
    failed_url: string;
    reason: 'SIZE_CAP_EXCEEDED' | 'FETCH_FAILED' | 'MISSING_PATH';
    attempted_retries: number;
  };

  constructor(message: string, attachmentDetails: AttachmentFetchError['attachmentDetails']) {
    super('ATTACHMENT_FETCH_FAILED', message, 422, [JSON.stringify(attachmentDetails)]);
    this.attachmentDetails = attachmentDetails;
  }
}
```

## Trade-off

Mild duplication — the structured object lives both as the typed field and as a JSON string in `details`. Worth it for type safety on the hot path while preserving wire compatibility.

## Cross-references

- Foundation: `.agent/knowledge/foundation/lib-errors.md`
- First use: `src/channels/attachments.ts` (Phase 7 H1, batch 006)
- Reusable for: webhook delivery callbacks (H4), Telegram media uploads, SMS provider failure metadata
