import fp from 'fastify-plugin';
import { Kafka } from 'kafkajs';
import type { Database } from '../db/client.js';

interface HealthRoutesOptions {
  db: Database;
  kafkaBrokers: string[];
  resendApiKey: string;
}

async function checkPostgres(db: Database): Promise<boolean> {
  try {
    await db.execute('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

async function checkKafka(brokers: string[]): Promise<boolean> {
  const kafka = new Kafka({
    brokers,
    connectionTimeout: 2000,
    retry: { retries: 1 },
    logLevel: 0, // NOTHING — suppress noisy KafkaJS logs during health checks
  });
  const admin = kafka.admin();
  try {
    await admin.connect();
    await admin.describeCluster();
    await admin.disconnect();
    return true;
  } catch {
    try { await admin.disconnect(); } catch { /* ignore */ }
    return false;
  }
}

async function checkResend(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(3000),
    });
    // Any response (even 401) means the API is reachable
    return response.status < 500;
  } catch {
    return false;
  }
}

export const healthRoutes = fp<HealthRoutesOptions>(async (app, opts) => {
  const { db, kafkaBrokers, resendApiKey } = opts;

  app.get('/api/health', async () => {
    const [pg, kafka, resend] = await Promise.allSettled([
      checkPostgres(db),
      checkKafka(kafkaBrokers),
      checkResend(resendApiKey),
    ]);

    const pgOk = pg.status === 'fulfilled' && pg.value;
    const kafkaOk = kafka.status === 'fulfilled' && kafka.value;
    const resendOk = resend.status === 'fulfilled' && resend.value;

    const allOk = pgOk && kafkaOk && resendOk;
    const allDown = !pgOk && !kafkaOk && !resendOk;

    return {
      status: allOk ? 'ok' : allDown ? 'down' : 'degraded',
      pg: pgOk,
      kafka: kafkaOk,
      resend: resendOk,
    };
  });
});
