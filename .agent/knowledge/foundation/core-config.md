# Config Loader

## What it establishes

Environment variable loading and validation. The config module reads `process.env` and exposes a typed config object — fails fast at startup if a required env is missing.

## Files

- `src/config.ts` — `loadConfig()` validates and exports `{ port, databaseUrl, kafka, resend, admin, ... }`.

## When to read this

Before adding any code that:
- Reads a new env var (the var goes here first, then to `.env.example`).
- Uses `process.env` directly anywhere — STOP and route through `loadConfig()` instead.

## Contract

- `loadConfig()` is called ONCE at startup in `src/server.ts`.
- `dotenv.config()` is called ONCE in `src/server.ts`, NOT here. See gotcha `2026-03-31-dotenv-server-only.md`.
- New envs are added to `.env.example` in the same commit.
