import { describe, it, expect } from 'vitest';
import { resolveTenantEventsRateLimit } from './rate-limiter.js';

const DEFAULT_MAX = 200;

describe('resolveTenantEventsRateLimit', () => {
  it('returns the configured per-tenant max when tenant has rate_limits.events_per_minute = 10', () => {
    const tenant = {
      config: { rate_limits: { events_per_minute: 10 } },
    } as { config: Record<string, unknown> };

    expect(resolveTenantEventsRateLimit(tenant)).toBe(10);
  });

  it('returns the configured per-tenant max when tenant has rate_limits.events_per_minute = 100', () => {
    const tenant = {
      config: { rate_limits: { events_per_minute: 100 } },
    } as { config: Record<string, unknown> };

    expect(resolveTenantEventsRateLimit(tenant)).toBe(100);
  });

  it('returns the default 200 when tenant has no rate_limits override', () => {
    const tenant = {
      config: { channels: { email: { apiKey: 'k', from: 'f' } } },
    } as { config: Record<string, unknown> };

    expect(resolveTenantEventsRateLimit(tenant)).toBe(DEFAULT_MAX);
  });

  it('returns the default 200 when tenant.config is null', () => {
    const tenant = { config: null } as { config: Record<string, unknown> | null };
    expect(resolveTenantEventsRateLimit(tenant)).toBe(DEFAULT_MAX);
  });

  it('caps the configured value at 1000 when tenant requests above the cap', () => {
    const tenant = {
      config: { rate_limits: { events_per_minute: 5000 } },
    } as { config: Record<string, unknown> };

    expect(resolveTenantEventsRateLimit(tenant)).toBe(1000);
  });
});
