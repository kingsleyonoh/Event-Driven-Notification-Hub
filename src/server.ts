import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import Fastify from 'fastify';
import { loadConfig } from './config.js';

export function buildApp() {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  app.get('/api/health', async () => {
    return { status: 'ok' };
  });

  return { app, config };
}

async function start() {
  const { app, config } = buildApp();

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
