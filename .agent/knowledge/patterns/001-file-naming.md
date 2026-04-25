# File Naming Convention

## Purpose

Consistent file/symbol naming so any contributor (human or AI) can predict where code lives and what an exported symbol will be called.

## When to use

- Every new TypeScript module, test, or script.

## How it works

- **Files:** `kebab-case.ts` for modules (e.g. `email-monitor.ts`, `quiet-hours-release.ts`).
- **Tests:** `module.test.ts` co-located next to the module under test.
- **Variables / functions:** `camelCase`.
- **Classes / types:** `PascalCase` (e.g. `AppError`, `DispatchConfig`).
- **Drizzle table objects:** `camelCase` (e.g. `notificationRules`).
- **Constants:** `UPPER_SNAKE_CASE`.

## Cross-references

- Originating: bootstrap conventions, 2026-03-31.
