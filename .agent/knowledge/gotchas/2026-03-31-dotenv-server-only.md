# dotenv must load in server.ts, not config.ts

- **Symptom:** Tests pollute `process.env`; later test files see leaked values from earlier ones.
- **Cause:** Calling `dotenv.config()` inside `src/config.ts` runs during every test import, repeatedly merging values into `process.env` that don't get reset between tests.
- **Solution:** Load dotenv ONLY in `src/server.ts` (the application entry point). Tests provide values explicitly via fixture / `beforeEach`. Keep `src/config.ts` as a pure validator that reads `process.env` without side effects.
- **Discovered in:** Event-Driven Notification Hub, config.ts TDD batch (2026-03-31).
- **Affects:** All Vitest test files that import the config module.
