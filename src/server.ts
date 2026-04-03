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
    resendApiKey: config.RESEND_API_KEY,
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
  const { app, config } = await buildApp();

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
