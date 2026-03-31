import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, sql } from '../test/setup.js';
import { createTestTenant, createTestPreferences, cleanupTestData } from '../test/factories.js';
import { checkOptOut, isWithinQuietHours, resolveDeliveryAddress } from './preferences.js';

let tenant: Awaited<ReturnType<typeof createTestTenant>>;

beforeAll(async () => {
  tenant = await createTestTenant(db);
});

afterAll(async () => {
  await cleanupTestData(db, tenant.id);
  await sql.end();
});

describe('checkOptOut', () => {
  it('returns true when user opted out of specific channel + event', () => {
    expect(checkOptOut({ email: ['order.completed'] }, 'email', 'order.completed')).toBe(true);
  });

  it('returns true when user opted out of channel with wildcard', () => {
    expect(checkOptOut({ sms: ['*'] }, 'sms', 'any.event')).toBe(true);
  });

  it('returns true when user opted out of all channels', () => {
    expect(checkOptOut({ all: ['*'] }, 'email', 'any.event')).toBe(true);
  });

  it('returns false for unrelated channel', () => {
    expect(checkOptOut({ email: ['order.completed'] }, 'sms', 'order.completed')).toBe(false);
  });

  it('returns false for unrelated event type', () => {
    expect(checkOptOut({ email: ['order.completed'] }, 'email', 'user.signup')).toBe(false);
  });

  it('returns false when optOut is null', () => {
    expect(checkOptOut(null, 'email', 'order.completed')).toBe(false);
  });
});

describe('isWithinQuietHours', () => {
  it('returns true when within overnight range', () => {
    const now = new Date('2026-03-31T23:30:00Z');
    expect(isWithinQuietHours({ start: '22:00', end: '07:00', timezone: 'UTC' }, now)).toBe(true);
  });

  it('returns false when outside overnight range', () => {
    const now = new Date('2026-03-31T08:00:00Z');
    expect(isWithinQuietHours({ start: '22:00', end: '07:00', timezone: 'UTC' }, now)).toBe(false);
  });

  it('returns true when within same-day range', () => {
    const now = new Date('2026-03-31T12:00:00Z');
    expect(isWithinQuietHours({ start: '09:00', end: '17:00', timezone: 'UTC' }, now)).toBe(true);
  });

  it('returns false when outside same-day range', () => {
    const now = new Date('2026-03-31T08:00:00Z');
    expect(isWithinQuietHours({ start: '09:00', end: '17:00', timezone: 'UTC' }, now)).toBe(false);
  });

  it('returns false when quietHours is null', () => {
    expect(isWithinQuietHours(null)).toBe(false);
  });

  it('returns false when quietHours is empty', () => {
    expect(isWithinQuietHours({})).toBe(false);
  });

  it('handles timezone conversion', () => {
    // 03:00 UTC = 22:00 EST (previous day)
    const now = new Date('2026-03-31T03:00:00Z');
    expect(isWithinQuietHours({ start: '22:00', end: '07:00', timezone: 'America/New_York' }, now)).toBe(true);
  });
});

describe('resolveDeliveryAddress', () => {
  it('returns email from preferences for email channel', async () => {
    await createTestPreferences(db, tenant.id, 'user-addr-1', { email: 'alice@example.com' });
    const result = await resolveDeliveryAddress(db, tenant.id, 'user-addr-1', 'email');
    expect(result.address).toBe('alice@example.com');
  });

  it('returns phone from preferences for sms channel', async () => {
    await createTestPreferences(db, tenant.id, 'user-addr-2', { phone: '+15551234567' });
    const result = await resolveDeliveryAddress(db, tenant.id, 'user-addr-2', 'sms');
    expect(result.address).toBe('+15551234567');
  });

  it('returns userId for in_app channel', async () => {
    const result = await resolveDeliveryAddress(db, tenant.id, 'user-addr-3', 'in_app');
    expect(result.address).toBe('user-addr-3');
  });

  it('returns null address when no preferences and email channel', async () => {
    const result = await resolveDeliveryAddress(db, tenant.id, 'no-prefs-user', 'email');
    expect(result.address).toBeNull();
  });

  it('returns null address when preferences exist but no email', async () => {
    await createTestPreferences(db, tenant.id, 'user-addr-4', { phone: '+1555' });
    const result = await resolveDeliveryAddress(db, tenant.id, 'user-addr-4', 'email');
    expect(result.address).toBeNull();
  });
});
