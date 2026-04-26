# Sandbox-only tenants still need a non-empty `apiKey` in email config

## Symptom

A tenant configured with `tenants.config.channels.email = { from, sandbox: true }` (no `apiKey`) silently bypasses the sandbox path. `notifications.status` lands as `failed` with `error_message: "Unable to fetch data. The request could not be resolved."` (real Resend error from the env-var fallback). The H5 `email sandboxed — Resend send skipped` log line never fires.

## Cause

`emailChannelConfigSchema` in `src/api/schemas.ts` declares `apiKey: z.string().min(1)` as **required**. When `resolveTenantChannelConfig()` runs Zod parse against the tenant config, validation FAILS (missing apiKey), so it returns `null`. The dispatcher's `resolveEmailConfig()` then falls through to `config.email` (env-var-built EmailConfig) which has the real `RESEND_API_KEY` and no `sandbox` flag — so the H5 short-circuit in `email.ts` never sees `config.sandbox === true` and a real Resend call goes out (which fails because the test recipient isn't deliverable).

Unit / integration tests for H5 (batch 014) didn't catch this because their fixtures always set BOTH `apiKey` AND `sandbox: true`. The schema-level requirement was invisible to tests; only real E2E with a sandbox-only tenant exposes it.

## Solution

**Workaround (today):** sandbox-only tenants must still set a non-empty placeholder `apiKey` in their email config (e.g., `"re_sandbox_placeholder"`). Validation passes; sandbox short-circuit fires before the placeholder is ever sent to Resend.

**Proper fix (Phase 7.5):** make `apiKey` optional when `sandbox: true`. Use a Zod `superRefine` that requires `apiKey` only when sandbox is absent or false:

```ts
emailChannelConfigSchema.superRefine((cfg, ctx) => {
  if (cfg.sandbox !== true && (!cfg.apiKey || cfg.apiKey.length === 0)) {
    ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'apiKey required unless sandbox=true' });
  }
});
```

Add a regression test that creates a sandbox-only tenant (no apiKey) and asserts the dispatch reaches the sandbox path.

## Discovered in

E2E smoke test on local dev, 2026-04-26, after Phase 7 code-complete. Found while exercising H5 sandbox + H7 rate limit + H10 suppressions over real HTTP/Postgres/Kafka.

## Affects

- All Phase 7 tenants intending to run sandbox-only (staging environments, CI smoke tests).
- Detection gap: any Phase 7 unit test for H5 that sets fixture with both fields together.
- Schema-level validation in `emailChannelConfigSchema` (the same shape risk applies to `telegramChannelConfigSchema.botToken` if a sandbox-equivalent ever lands there).
