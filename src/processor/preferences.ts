import { eq, and } from 'drizzle-orm';
import { userPreferences } from '../db/schema.js';
import type { Database } from '../db/client.js';

export function checkOptOut(
  optOut: Record<string, string[]> | null,
  channel: string,
  eventType: string,
): boolean {
  if (!optOut) return false;

  const channelOpts = optOut[channel];
  if (channelOpts?.includes(eventType) || channelOpts?.includes('*')) return true;

  const allOpts = optOut['all'];
  if (allOpts?.includes(eventType) || allOpts?.includes('*')) return true;

  return false;
}

export function isWithinQuietHours(
  quietHours: { start?: string; end?: string; timezone?: string } | null,
  now: Date = new Date(),
): boolean {
  if (!quietHours?.start || !quietHours?.end) return false;

  const tz = quietHours.timezone ?? 'UTC';
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  });

  const localTime = formatter.format(now); // "HH:MM"
  const [h, m] = localTime.split(':').map(Number);
  const currentMinutes = h * 60 + m;

  const [sh, sm] = quietHours.start.split(':').map(Number);
  const startMinutes = sh * 60 + sm;

  const [eh, em] = quietHours.end.split(':').map(Number);
  const endMinutes = eh * 60 + em;

  if (startMinutes <= endMinutes) {
    // Same-day range (e.g., 09:00 - 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range (e.g., 22:00 - 07:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

export async function resolveDeliveryAddress(
  db: Database,
  tenantId: string,
  recipient: string,
  channel: 'email' | 'sms' | 'in_app' | 'telegram',
): Promise<{ address: string | null; preferences: typeof userPreferences.$inferSelect | null }> {
  // in_app always uses the recipient as the userId
  if (channel === 'in_app') {
    return { address: recipient, preferences: null };
  }

  const [prefs] = await db
    .select()
    .from(userPreferences)
    .where(
      and(
        eq(userPreferences.tenantId, tenantId),
        eq(userPreferences.userId, recipient),
      ),
    )
    .limit(1);

  if (!prefs) {
    return { address: null, preferences: null };
  }

  let address: string | null = null;
  if (channel === 'email') {
    address = prefs.email;
  } else if (channel === 'sms') {
    address = prefs.phone;
  } else if (channel === 'telegram') {
    address = prefs.telegramChatId;
  }
  return { address: address ?? null, preferences: prefs };
}
