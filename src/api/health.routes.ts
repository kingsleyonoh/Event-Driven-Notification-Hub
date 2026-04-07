import fp from 'fastify-plugin';
import { Kafka } from 'kafkajs';
import type { Database } from '../db/client.js';

interface HealthRoutesOptions {
  db: Database;
  kafkaBrokers: string[];
  resendApiKey: string;
  useKafka?: boolean;
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
  const { db, kafkaBrokers, resendApiKey, useKafka = true } = opts;

  app.get('/api/health', async () => {
    const checks: Promise<boolean>[] = [checkPostgres(db)];

    if (useKafka && kafkaBrokers.length > 0) {
      checks.push(checkKafka(kafkaBrokers));
    }

    checks.push(checkResend(resendApiKey));

    const results = await Promise.allSettled(checks);
    const pgOk = results[0].status === 'fulfilled' && results[0].value;

    let kafkaOk: boolean | null = null;
    let resendOk: boolean;

    if (useKafka && kafkaBrokers.length > 0) {
      kafkaOk = results[1].status === 'fulfilled' && results[1].value;
      resendOk = results[2].status === 'fulfilled' && results[2].value;
    } else {
      resendOk = results[1].status === 'fulfilled' && results[1].value;
    }

    const coreOk = pgOk && resendOk && (kafkaOk === null || kafkaOk);
    const allDown = !pgOk && !resendOk;

    const response: Record<string, unknown> = {
      status: coreOk ? 'ok' : allDown ? 'down' : 'degraded',
      pg: pgOk,
      resend: resendOk,
    };

    if (kafkaOk !== null) {
      response.kafka = kafkaOk;
    } else {
      response.mode = 'direct';
    }

    return response;
  });
});
