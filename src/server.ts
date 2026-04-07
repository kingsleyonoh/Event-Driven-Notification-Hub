import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import { loadConfig, type Config } from './config.js';
import { createDb, type Database } from './db/client.js';
import { errorHandlerPlugin } from './api/middleware/error-handler.js';
import { rateLimiterPlugin } from './api/middleware/rate-limiter.js';
import { authPlugin } from './api/middleware/auth.js';
import { adminAuthPlugin } from './api/middleware/admin-auth.js';
import { healthRoutes } from './api/health.routes.js';
import { rulesRoutes } from './api/rules.routes.js';
import { templatesRoutes } from './api/templates.routes.js';
import { eventsRoutes } from './api/events.routes.js';
import { preferencesRoutes } from './api/preferences.routes.js';
import { notificationsRoutes } from './api/notifications.routes.js';
import { adminRoutes } from './api/admin.routes.js';
import { heartbeatRoutes } from './heartbeat/routes.js';
import { wsPlugin } from './ws/handler.js';
import { createJobScheduler } from './jobs/scheduler.js';
import { processDigestQueue } from './digest/engine.js';
import { releaseHeldNotifications } from './processor/quiet-hours-release.js';
import { checkStaleHeartbeats } from './heartbeat/checker.js';
import { cleanupOldNotifications } from './processor/notification-cleanup.js';
import { disconnectProducer } from './consumer/producer.js';
import { checkConsumerLag } from './consumer/lag-monitor.js';
import { checkEmailFailureRate } from './channels/email-monitor.js';
import { createTelegramBotWorker } from './channels/telegram-bot.js';
import { createConsumer } from './consumer/kafka.js';
import { processNotification } from './processor/pipeline.js';

export async function buildApp(overrides?: { config?: Config; db?: Database }) {
  const config = overrides?.config ?? loadConfig();
  const { db, sql } = overrides?.db
    ? { db: overrides.db, sql: undefined }
    : createDb(config.DATABASE_URL);

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false, // API-only, no HTML to protect
  });

  // Middleware — registration order matters
  await app.register(errorHandlerPlugin);
  await app.register(rateLimiterPlugin);
  await app.register(adminAuthPlugin, { adminApiKey: config.ADMIN_API_KEY });
  await app.register(authPlugin, { db });

  // Routes
  await app.register(healthRoutes, {
    db,
    kafkaBrokers: config.KAFKA_BROKERS,
    resendApiKey: config.RESEND_API_KEY ?? '',
    useKafka: config.USE_KAFKA,
  });
  await app.register(rulesRoutes, { db });
  await app.register(templatesRoutes, { db });
  const emailConfig = config.RESEND_API_KEY && config.RESEND_FROM
    ? { apiKey: config.RESEND_API_KEY, from: config.RESEND_FROM }
    : undefined;

  await app.register(eventsRoutes, {
    db,
    kafkaBrokers: config.KAFKA_BROKERS,
    kafkaTopics: config.KAFKA_TOPICS,
    useKafka: config.USE_KAFKA,
    pipelineConfig: {
      dedupWindowMinutes: config.DEDUP_WINDOW_MINUTES,
      digestSchedule: config.DIGEST_SCHEDULE,
      dispatch: { email: emailConfig },
    },
  });
  await app.register(preferencesRoutes, { db });
  await app.register(notificationsRoutes, { db });
  await app.register(adminRoutes, { db });
  await app.register(heartbeatRoutes, { db });

  // WebSocket
  await app.register(wsPlugin, { db });

  return { app, config, db, sql };
}

async function start() {
  const { app, config, db, sql } = await buildApp();

  const dispatchConfig = {
    email: config.RESEND_API_KEY && config.RESEND_FROM
      ? { apiKey: config.RESEND_API_KEY, from: config.RESEND_FROM }
      : undefined,
  };

  // Telegram bot polling worker
  const telegramBot = createTelegramBotWorker(db);

  // Background jobs
  const digestIntervalMs = config.DIGEST_SCHEDULE === 'hourly' ? 3600_000 : 86400_000;

  const scheduler = createJobScheduler([
    {
      name: 'digest-sender',
      fn: () => dispatchConfig.email
        ? processDigestQueue(db, dispatchConfig.email).then(() => {})
        : Promise.resolve(),
      intervalMs: digestIntervalMs,
    },
    {
      name: 'quiet-hours-release',
      fn: () => releaseHeldNotifications(db, dispatchConfig).then(() => {}),
      intervalMs: config.QUIET_HOURS_CHECK_INTERVAL_MS,
    },
    ...(config.USE_KAFKA ? [{
      name: 'heartbeat-checker',
      fn: () => checkStaleHeartbeats(db, config.KAFKA_BROKERS).then(() => {}),
      intervalMs: 900_000, // 15 minutes
    }] : []),
    {
      name: 'notification-cleanup',
      fn: () => cleanupOldNotifications(db, config.NOTIFICATION_RETENTION_DAYS).then(() => {}),
      intervalMs: 86400_000, // daily
    },
    ...(config.USE_KAFKA ? [{
      name: 'consumer-lag-check',
      fn: () => checkConsumerLag(config.KAFKA_BROKERS, config.KAFKA_GROUP_ID).then(() => {}),
      intervalMs: 60_000, // every 60s
    }] : []),
    {
      name: 'email-failure-rate-check',
      fn: async () => { checkEmailFailureRate(); },
      intervalMs: 60_000, // every 60s
    },
    {
      name: 'telegram-bot-poll',
      fn: () => telegramBot.poll(),
      intervalMs: 10_000, // every 10s
    },
  ]);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    scheduler.stop();
    if (consumer) await consumer.disconnect();
    await app.close();
    await disconnectProducer();
    if (sql) await sql.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Kafka consumer — only start if USE_KAFKA=true
  let consumer: { disconnect: () => Promise<void> } | undefined;
  if (config.USE_KAFKA && config.KAFKA_BROKERS.length > 0) {
    try {
      consumer = await createConsumer(
        { brokers: config.KAFKA_BROKERS, groupId: config.KAFKA_GROUP_ID, topics: config.KAFKA_TOPICS },
        db,
        async (event, rules, recipients, tenant) => {
          const pipelineConfig = {
            dedupWindowMinutes: config.DEDUP_WINDOW_MINUTES,
            digestSchedule: config.DIGEST_SCHEDULE,
            dispatch: { ...dispatchConfig, tenantConfig: tenant.config as Record<string, unknown> | null },
            tenantConfig: tenant.config as Record<string, unknown> | null,
          };
          for (const rule of rules) {
            const recipient = recipients.get(rule.id);
            if (recipient) {
              await processNotification(db, event, rule, recipient, pipelineConfig);
            }
          }
        },
      );
      app.log.info('Kafka consumer started');
    } catch (err) {
      app.log.error({ err }, 'Failed to start Kafka consumer — events will not be processed');
    }
  } else {
    app.log.info('Direct processing mode — events processed inline without Kafka');
  }

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    scheduler.start();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Only start when run directly (not when imported in tests)
const isMainModule = process.argv[1]?.endsWith('server.js') || process.argv[1]?.endsWith('server.ts');
if (isMainModule) {
  start();
}
