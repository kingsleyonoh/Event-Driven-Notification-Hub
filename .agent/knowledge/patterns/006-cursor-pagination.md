# Cursor-Based Pagination on Notification Listings

## Purpose

Paginate notification listings without offset/limit (which gets slow at scale and breaks under inserts).

## When to use

- `GET /api/notifications` and any other large-dataset listing endpoint.

## How it works

- The cursor is the opaque `created_at + id` of the last row of the previous page (base64-encoded).
- Default page size is 50, capped at 200.
- Query: `ORDER BY created_at DESC, id DESC` with `WHERE (created_at, id) < (cursor.created_at, cursor.id)`.
- Response shape:
  ```json
  { "data": [...], "nextCursor": "eyJ..." | null }
  ```

## Cross-references

- Module: `.agent/knowledge/modules/src-api-notifications-routes.md`
