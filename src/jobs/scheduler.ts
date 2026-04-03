import { createLogger } from '../lib/logger.js';

const logger = createLogger('scheduler');

export interface JobDefinition {
  name: string;
  fn: () => Promise<void>;
  intervalMs: number;
}

export interface JobScheduler {
  start(): void;
  stop(): void;
}

export function createJobScheduler(jobs: JobDefinition[]): JobScheduler {
  const timers: NodeJS.Timeout[] = [];

  return {
    start() {
      for (const job of jobs) {
        const timer = setInterval(() => {
          job.fn().catch((err) => {
            logger.error({ job: job.name, err }, 'background job failed');
          });
        }, job.intervalMs);

        timers.push(timer);
        logger.info({ job: job.name, intervalMs: job.intervalMs }, 'background job scheduled');
      }
    },

    stop() {
      for (const timer of timers) {
        clearInterval(timer);
      }
      timers.length = 0;
      logger.info('all background jobs stopped');
    },
  };
}
