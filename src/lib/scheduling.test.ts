import { describe, it, expect } from 'vitest';
import { computeScheduledFor } from './scheduling.js';

describe('computeScheduledFor', () => {
  describe('hourly', () => {
    it('returns next hour boundary', () => {
      const now = new Date('2026-03-31T14:23:00Z');
      const result = computeScheduledFor('hourly', now);
      expect(result).toEqual(new Date('2026-03-31T15:00:00Z'));
    });

    it('at exactly HH:00:00 returns next hour', () => {
      const now = new Date('2026-03-31T14:00:00Z');
      const result = computeScheduledFor('hourly', now);
      expect(result).toEqual(new Date('2026-03-31T15:00:00Z'));
    });
  });

  describe('daily', () => {
    it('before 09:00 UTC returns today 09:00', () => {
      const now = new Date('2026-03-31T07:30:00Z');
      const result = computeScheduledFor('daily', now);
      expect(result).toEqual(new Date('2026-03-31T09:00:00Z'));
    });

    it('after 09:00 UTC returns tomorrow 09:00', () => {
      const now = new Date('2026-03-31T10:00:00Z');
      const result = computeScheduledFor('daily', now);
      expect(result).toEqual(new Date('2026-04-01T09:00:00Z'));
    });

    it('at exactly 09:00 UTC returns tomorrow 09:00', () => {
      const now = new Date('2026-03-31T09:00:00Z');
      const result = computeScheduledFor('daily', now);
      expect(result).toEqual(new Date('2026-04-01T09:00:00Z'));
    });
  });

  describe('weekly', () => {
    it('on Tuesday returns next Monday 09:00', () => {
      const now = new Date('2026-03-31T12:00:00Z'); // Tuesday
      const result = computeScheduledFor('weekly', now);
      expect(result).toEqual(new Date('2026-04-06T09:00:00Z')); // Next Monday
    });

    it('on Monday before 09:00 returns today 09:00', () => {
      const now = new Date('2026-04-06T07:00:00Z'); // Monday
      const result = computeScheduledFor('weekly', now);
      expect(result).toEqual(new Date('2026-04-06T09:00:00Z'));
    });

    it('on Monday after 09:00 returns next Monday 09:00', () => {
      const now = new Date('2026-04-06T10:00:00Z'); // Monday
      const result = computeScheduledFor('weekly', now);
      expect(result).toEqual(new Date('2026-04-13T09:00:00Z'));
    });
  });
});
