import { z } from 'zod/v4';

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  DATABASE_URL: z.string().min(1),

  USE_KAFKA: z.enum(['true', 'false']).default('true').transform((val) => val === 'true'),

  KAFKA_BROKERS: z.string().optional().transform((val) => val ? val.split(',').map((b) => b.trim()) : []),
  KAFKA_GROUP_ID: z.string().default('notification-hub'),
  KAFKA_TOPICS: z.string().default('events.notifications'),

  RESEND_API_KEY: z.string().min(1).optional(),
  RESEND_FROM: z.string().min(1).optional(),

  API_KEYS: z.string().min(1).transform((val) => val.split(',').map((k) => k.trim())),
  ADMIN_API_KEY: z.string().min(1),
  DEFAULT_TENANT_ID: z.string().default('default'),

  DEDUP_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),
  DIGEST_SCHEDULE: z.enum(['hourly', 'daily', 'weekly']).default('daily'),
  QUIET_HOURS_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(900000),
  NOTIFICATION_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = z.prettifyError(result.error);
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }

  return result.data;
}
