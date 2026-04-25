# Build Journal — Index

> **One file per batch.** This index is a human-readable catalog, rewritten by the AI whenever a sibling file is added. Never append to a single growing journal file — write a new sibling instead. See `.agent/rules/CODING_STANDARDS.md` — "Append-Only Knowledge Files Banned."

## Catalog

| Batch | File | Summary |
|-------|------|---------|
| 006 | `006-batch.md` | Phase 7 H1 foundation — `templates.attachments_config` column, Zod schema, `fetchAttachments()` module + 14 tests. |
| 007 | `007-batch.md` | Phase 7 H1 wiring — `EmailConfig.attachments` + pipeline `fetchAttachments()` call + 4 integration tests. H1 COMPLETE. |
| 008 | `008-batch.md` | Phase 7 H2 part 1 — `templates.reply_to` column, tenant config Zod `replyTo`, `EmailConfig.replyTo` → Resend SDK. |

## How batch files are written

`yolo-subagent-journal` writes one file per batch at path `docs/build-journal/NNN-batch.md` where `NNN` is the zero-padded batch number. Each file contains:

- **Narrative** — what the batch accomplished
- **Design decisions** — non-obvious choices and why
- **Gotchas captured** — any new gotcha files written under `.agent/knowledge/gotchas/`
- **New patterns established** — any new pattern files written under `.agent/knowledge/patterns/`

The sub-agent then adds one row to the `## Catalog` table above with the batch number, filename, and a one-line summary.

## Why directory-per-kind

The old flat `docs/build-journal.md` grew by one section per batch forever. At 20 batches it was readable; at 100 batches it was 40K characters and rarely re-read. One file per batch means each file stays focused, git history is per-batch, and cross-references (e.g. "Batch 017 established the row-lock allocator pattern") become file links, not search operations.
