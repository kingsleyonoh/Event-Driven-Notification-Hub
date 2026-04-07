import { describe, it, expect } from 'vitest';
import { resolveTenantChannelConfig } from './channel-config.js';

describe('resolveTenantChannelConfig', () => {
  it('extracts valid email config from tenant config', () => {
    const tenantConfig: Record<string, unknown> = {
      channels: {
        email: { apiKey: 're_test_123', from: 'noreply@tenant.com' },
      },
    };

    const result = resolveTenantChannelConfig(tenantConfig, 'email');

    expect(result).toEqual({ apiKey: 're_test_123', from: 'noreply@tenant.com' });
  });

  it('returns null when channel is not configured', () => {
    const tenantConfig: Record<string, unknown> = {
      channels: {
        email: { apiKey: 're_test_123', from: 'noreply@tenant.com' },
      },
    };

    const result = resolveTenantChannelConfig(tenantConfig, 'telegram');

    expect(result).toBeNull();
  });

  it('returns null when tenantConfig is null', () => {
    const result = resolveTenantChannelConfig(null, 'email');

    expect(result).toBeNull();
  });

  it('returns null when tenantConfig has no channels key', () => {
    const tenantConfig: Record<string, unknown> = { somethingElse: true };

    const result = resolveTenantChannelConfig(tenantConfig, 'email');

    expect(result).toBeNull();
  });

  it('returns null when channel config has malformed shape', () => {
    const tenantConfig: Record<string, unknown> = {
      channels: {
        email: { apiKey: 're_test_123' }, // missing 'from'
      },
    };

    const result = resolveTenantChannelConfig(tenantConfig, 'email');

    expect(result).toBeNull();
  });

  it('extracts valid telegram config from tenant config', () => {
    const tenantConfig: Record<string, unknown> = {
      channels: {
        telegram: { botToken: '123:ABC', botUsername: 'MyBot' },
      },
    };

    const result = resolveTenantChannelConfig(tenantConfig, 'telegram');

    expect(result).toEqual({ botToken: '123:ABC', botUsername: 'MyBot' });
  });

  it('returns null when channels value is not an object', () => {
    const tenantConfig: Record<string, unknown> = {
      channels: 'invalid',
    };

    const result = resolveTenantChannelConfig(tenantConfig, 'email');

    expect(result).toBeNull();
  });
});
