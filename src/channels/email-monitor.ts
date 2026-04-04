import { createLogger } from '../lib/logger.js';

const logger = createLogger('email-monitor');
const FAILURE_RATE_THRESHOLD = 20; // percent
const WINDOW_MS = 3600_000; // 1 hour

interface EmailEvent {
  success: boolean;
  timestamp: number;
}

const events: EmailEvent[] = [];

export function recordEmailResult(success: boolean): void {
  events.push({ success, timestamp: Date.now() });
}

export function checkEmailFailureRate(): {
  sent: number;
  failed: number;
  rate: number;
  warning: boolean;
} {
  const cutoff = Date.now() - WINDOW_MS;

  // Prune old events
  while (events.length > 0 && events[0].timestamp < cutoff) {
    events.shift();
  }

  const sent = events.length;
  const failed = events.filter((e) => !e.success).length;
  const rate = sent > 0 ? Math.round((failed / sent) * 100 * 100) / 100 : 0;
  const warning = rate > FAILURE_RATE_THRESHOLD;

  if (warning) {
    logger.warn({ sent, failed, rate, threshold: FAILURE_RATE_THRESHOLD }, 'email failure rate exceeds threshold');
  }

  return { sent, failed, rate, warning };
}

export function resetEmailMonitor(): void {
  events.length = 0;
}
