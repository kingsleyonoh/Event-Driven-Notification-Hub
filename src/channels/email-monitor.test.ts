import { describe, it, expect, beforeEach } from 'vitest';
import { recordEmailResult, checkEmailFailureRate, resetEmailMonitor } from './email-monitor.js';

beforeEach(() => {
  resetEmailMonitor();
});

describe('Email delivery monitor', () => {
  it('tracks success and failure counts', () => {
    recordEmailResult(true);
    recordEmailResult(true);
    recordEmailResult(false);

    const { sent, failed, rate } = checkEmailFailureRate();

    expect(sent).toBe(3);
    expect(failed).toBe(1);
    expect(rate).toBeCloseTo(33.33, 0);
  });

  it('returns warning when failure rate exceeds 20%', () => {
    // 2 success, 3 failures = 60% failure rate
    recordEmailResult(true);
    recordEmailResult(true);
    recordEmailResult(false);
    recordEmailResult(false);
    recordEmailResult(false);

    const { rate, warning } = checkEmailFailureRate();

    expect(rate).toBe(60);
    expect(warning).toBe(true);
  });

  it('does not warn when rate is below threshold', () => {
    // 9 success, 1 failure = 10% failure rate
    for (let i = 0; i < 9; i++) recordEmailResult(true);
    recordEmailResult(false);

    const { rate, warning } = checkEmailFailureRate();

    expect(rate).toBe(10);
    expect(warning).toBe(false);
  });

  it('returns 0 rate with no sends', () => {
    const { sent, failed, rate, warning } = checkEmailFailureRate();

    expect(sent).toBe(0);
    expect(failed).toBe(0);
    expect(rate).toBe(0);
    expect(warning).toBe(false);
  });
});
