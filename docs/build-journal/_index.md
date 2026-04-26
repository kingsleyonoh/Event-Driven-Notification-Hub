# Build Journal — Index

> **One file per batch.** This index is a human-readable catalog, rewritten by the AI whenever a sibling file is added. Never append to a single growing journal file — write a new sibling instead. See `.agent/rules/CODING_STANDARDS.md` — "Append-Only Knowledge Files Banned."

## Catalog

| Batch | File | Summary |
|-------|------|---------|
| 006 | `006-batch.md` | Phase 7 H1 foundation — `templates.attachments_config` column, Zod schema, `fetchAttachments()` module + 14 tests. |
| 007 | `007-batch.md` | Phase 7 H1 wiring — `EmailConfig.attachments` + pipeline `fetchAttachments()` call + 4 integration tests. H1 COMPLETE. |
| 008 | `008-batch.md` | Phase 7 H2 part 1 — `templates.reply_to` column, tenant config Zod `replyTo`, `EmailConfig.replyTo` → Resend SDK. |
| 009 | `009-batch.md` | Phase 7 H2 part 2 — dispatcher 3-layer reply_to resolution + 5 tests. **H2 COMPLETE.** |
| 010 | `010-batch.md` | Phase 7 H3 — custom email headers (RFC 8058 List-Unsubscribe), Handlebars rendering, 13 tests. **H3 COMPLETE.** Pattern 009. |
| 011 | `011-batch.md` | Phase 7 H4 part 1 — `email_delivery_events` table, `tenants.delivery_callback_secret`, signing module. Pattern 010 (HMAC outbound callback). |
| 012 | `012-batch.md` | Phase 7 H4 part 2 — `POST /api/webhooks/resend`, Svix sig verify, X-Hub-* metadata round-trip, admin mints `delivery_callback_secret`. |
| 013 | `013-batch.md` | Phase 7 H4 part 3 — webhook integration tests + USER_SETUP docs. **H4 COMPLETE. Ship-gate CRITICAL/HIGH set DONE (H1+H2+H3+H4).** |
| 014 | `014-batch.md` | Phase 7 H5 — sandbox mode per tenant. Status CHECK widened to `sent_sandbox`. **H5 COMPLETE.** Gotcha: drizzle-text-enum-no-check-constraint. |
| 015 | `015-batch.md` | Phase 7 H8 — plain-text email body fallback (`body_text`). **H8 COMPLETE.** |
| 016 | `016-batch.md` | Phase 7 H7 — per-tenant rate limit on `/api/events` + admin PATCH route. **H7 COMPLETE.** Hook-ordering fix (preHandler vs onRequest). |
| 017 | `017-batch.md` | Phase 7 H10 part 1 — `tenant_suppressions` table + pipeline guard + webhook auto-add on hard-bounce/complaint. |
| 018 | `018-batch.md` | Phase 7 H10 part 2 — suppressions CRUD routes, cursor microsecond fix. **H10 COMPLETE.** |
| 019 | `019-batch.md` | Phase 7 H9 — multi-language template variants (locale + en fallback). **H9 COMPLETE.** |

## How batch files are written

`yolo-subagent-journal` writes one file per batch at path `docs/build-journal/NNN-batch.md` where `NNN` is the zero-padded batch number. Each file contains:

- **Narrative** — what the batch accomplished
- **Design decisions** — non-obvious choices and why
- **Gotchas captured** — any new gotcha files written under `.agent/knowledge/gotchas/`
- **New patterns established** — any new pattern files written under `.agent/knowledge/patterns/`

The sub-agent then adds one row to the `## Catalog` table above with the batch number, filename, and a one-line summary.

## Why directory-per-kind

The old flat `docs/build-journal.md` grew by one section per batch forever. At 20 batches it was readable; at 100 batches it was 40K characters and rarely re-read. One file per batch means each file stays focused, git history is per-batch, and cross-references (e.g. "Batch 017 established the row-lock allocator pattern") become file links, not search operations.
