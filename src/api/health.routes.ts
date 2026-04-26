import fp from 'fastify-plugin';
import { Kafka } from 'kafkajs';
import { gte, count } from 'drizzle-orm';
import { emailDeliveryEvents } from '../db/schema.js';
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

/**
 * Phase 7 7b — count email_delivery_events rows in the last 24 hours.
 * Proxy for "is the H4 callback flow healthy?" Low count = either healthy
 * production traffic OR Resend webhook misconfigured. Global (cross-tenant)
 * because `/api/health` is a public/global endpoint.
 */
async function emailDeliveryEvents24hCount(db: Database): Promise<number> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [row] = await db
      .select({ value: count() })
      .from(emailDeliveryEvents)
      .where(gte(emailDeliveryEvents.createdAt, since));
    return Number(row?.value ?? 0);
  } catch {
    // Never fail the health check on this axis — it's an observability hint,
    // not a liveness signal.
    return 0;
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

    // Phase 7 7b — observability axis (not a liveness gate).
    const eventsCount = await emailDeliveryEvents24hCount(db);

    const response: Record<string, unknown> = {
      status: coreOk ? 'ok' : allDown ? 'down' : 'degraded',
      pg: pgOk,
      resend: resendOk,
      email_delivery_events_24h_count: eventsCount,
    };

    if (kafkaOk !== null) {
      response.kafka = kafkaOk;
    } else {
      response.mode = 'direct';
    }

    return response;
  });
});
