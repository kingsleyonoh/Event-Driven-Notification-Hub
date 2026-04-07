import { z } from 'zod/v4';

import {
  emailChannelConfigSchema,
  telegramChannelConfigSchema,
} from '../api/schemas.js';

const channelSchemas: Record<string, z.ZodType> = {
  email: emailChannelConfigSchema,
  telegram: telegramChannelConfigSchema,
};

/**
 * Extracts and validates channel-specific credentials from a tenant's
 * config JSONB. Returns the typed config object or null if the channel
 * is not configured or the shape is invalid.
 */
export function resolveTenantChannelConfig(
  tenantConfig: Record<string, unknown> | null,
  channel: string,
): Record<string, string> | null {
  if (!tenantConfig) return null;

  const channels = tenantConfig.channels;
  if (!channels || typeof channels !== 'object' || Array.isArray(channels)) {
    return null;
  }

  const channelData = (channels as Record<string, unknown>)[channel];
  if (!channelData || typeof channelData !== 'object') {
    return null;
  }

  const schema = channelSchemas[channel];
  if (!schema) {
    // Unknown channel — return as-is if it's a plain object
    return channelData as Record<string, string>;
  }

  const result = schema.safeParse(channelData);
  if (!result.success) return null;

  return result.data as Record<string, string>;
}
