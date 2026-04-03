import { describe, it, expect, vi, afterEach } from 'vitest';
import { createJobScheduler } from './scheduler.js';

describe('createJobScheduler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts all registered jobs with correct intervals', () => {
    vi.useFakeTimers();
    const job1 = vi.fn().mockResolvedValue(undefined);
    const job2 = vi.fn().mockResolvedValue(undefined);

    const scheduler = createJobScheduler([
      { name: 'job1', fn: job1, intervalMs: 1000 },
      { name: 'job2', fn: job2, intervalMs: 2000 },
    ]);

    scheduler.start();

    vi.advanceTimersByTime(2000);

    expect(job1).toHaveBeenCalledTimes(2);
    expect(job2).toHaveBeenCalledTimes(1);

    scheduler.stop();
    vi.useRealTimers();
  });

  it('stop clears all intervals', () => {
    vi.useFakeTimers();
    const job = vi.fn().mockResolvedValue(undefined);

    const scheduler = createJobScheduler([
      { name: 'test-job', fn: job, intervalMs: 1000 },
    ]);

    scheduler.start();
    vi.advanceTimersByTime(1000);
    expect(job).toHaveBeenCalledTimes(1);

    scheduler.stop();
    vi.advanceTimersByTime(5000);
    expect(job).toHaveBeenCalledTimes(1); // no more calls after stop

    vi.useRealTimers();
  });

  it('catches and logs job errors without crashing', async () => {
    vi.useFakeTimers();
    const failingJob = vi.fn().mockRejectedValue(new Error('boom'));

    const scheduler = createJobScheduler([
      { name: 'failing-job', fn: failingJob, intervalMs: 500 },
    ]);

    scheduler.start();
    vi.advanceTimersByTime(500);

    // Allow the rejection to be handled
    await vi.advanceTimersByTimeAsync(0);

    expect(failingJob).toHaveBeenCalledTimes(1);
    // Should not throw — scheduler catches errors

    scheduler.stop();
    vi.useRealTimers();
  });
});
