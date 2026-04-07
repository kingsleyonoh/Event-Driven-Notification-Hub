import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import Fastify from 'fastify';
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
  });
  await app.register(rulesRoutes, { db });
  await app.register(templatesRoutes, { db });
  await app.register(eventsRoutes, {
    kafkaBrokers: config.KAFKA_BROKERS,
    kafkaTopics: 'events.notifications',
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

  const emailConfig = config.RESEND_API_KEY && config.RESEND_FROM
    ? { apiKey: config.RESEND_API_KEY, from: config.RESEND_FROM }
    : undefined;
  const dispatchConfig = { email: emailConfig };

  // Background jobs
  const digestIntervalMs = config.DIGEST_SCHEDULE === 'hourly' ? 3600_000 : 86400_000;

  const scheduler = createJobScheduler([
    {
      name: 'digest-sender',
      fn: () => emailConfig
        ? processDigestQueue(db, emailConfig).then(() => {})
        : Promise.resolve(),
      intervalMs: digestIntervalMs,
    },
    {
      name: 'quiet-hours-release',
      fn: () => releaseHeldNotifications(db, dispatchConfig).then(() => {}),
      intervalMs: config.QUIET_HOURS_CHECK_INTERVAL_MS,
    },
    {
      name: 'heartbeat-checker',
      fn: () => checkStaleHeartbeats(db, config.KAFKA_BROKERS).then(() => {}),
      intervalMs: 900_000, // 15 minutes
    },
    {
      name: 'notification-cleanup',
      fn: () => cleanupOldNotifications(db, config.NOTIFICATION_RETENTION_DAYS).then(() => {}),
      intervalMs: 86400_000, // daily
    },
    {
      name: 'consumer-lag-check',
      fn: () => checkConsumerLag(config.KAFKA_BROKERS, config.KAFKA_GROUP_ID).then(() => {}),
      intervalMs: 60_000, // every 60s
    },
    {
      name: 'email-failure-rate-check',
      fn: async () => { checkEmailFailureRate(); },
      intervalMs: 60_000, // every 60s
    },
  ]);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    scheduler.stop();
    await app.close();
    await disconnectProducer();
    if (sql) await sql.end();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

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
