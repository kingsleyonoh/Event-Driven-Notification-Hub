import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

/**
 * Phase 7 H7 — default events-per-minute rate limit when a tenant has no
 * `config.rate_limits.events_per_minute` override. Matches the historical
 * hardcoded value before per-tenant configuration was introduced.
 */
export const DEFAULT_EVENTS_PER_MINUTE = 200;

/**
 * Phase 7 H7 — defensive cap on per-tenant rate limits. The admin PATCH
 * route also enforces this at the API boundary; this cap exists as a
 * second line of defense so a malformed config can't blow past it.
 */
export const MAX_EVENTS_PER_MINUTE = 1000;

/**
 * Resolves the per-tenant events-per-minute rate limit from
 * `tenant.config.rate_limits.events_per_minute`. Falls back to
 * `DEFAULT_EVENTS_PER_MINUTE` when no override is set or the config is
 * malformed. Caps at `MAX_EVENTS_PER_MINUTE`.
 */
export function resolveTenantEventsRateLimit(
  tenant: { config: Record<string, unknown> | null } | null | undefined,
): number {
  if (!tenant) return DEFAULT_EVENTS_PER_MINUTE;
  const config = tenant.config;
  if (!config || typeof config !== 'object') return DEFAULT_EVENTS_PER_MINUTE;

  const rateLimits = (config as Record<string, unknown>).rate_limits;
  if (!rateLimits || typeof rateLimits !== 'object') {
    return DEFAULT_EVENTS_PER_MINUTE;
  }

  const epm = (rateLimits as Record<string, unknown>).events_per_minute;
  if (typeof epm !== 'number' || !Number.isFinite(epm) || epm < 1) {
    return DEFAULT_EVENTS_PER_MINUTE;
  }

  return Math.min(Math.floor(epm), MAX_EVENTS_PER_MINUTE);
}

export const rateLimiterPlugin = fp(async (app) => {
  await app.register(rateLimit, {
    global: false,
    max: 200,
    timeWindow: '1 minute',
  });
});
