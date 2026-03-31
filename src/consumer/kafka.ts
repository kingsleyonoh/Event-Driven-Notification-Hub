import { type Consumer } from 'kafkajs';
import { z } from 'zod/v4';
import { eq } from 'drizzle-orm';
import { getKafkaClient } from './producer.js';
import { matchRules, resolveRecipient } from './router.js';
import { tenants } from '../db/schema.js';
import { createLogger } from '../lib/logger.js';
import type { Database } from '../db/client.js';

const logger = createLogger('kafka-consumer');

export const kafkaEventSchema = z.object({
  tenant_id: z.string().min(1),
  event_type: z.string().min(1),
  event_id: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.string(),
});

export type KafkaEvent = z.infer<typeof kafkaEventSchema>;

export interface ConsumerConfig {
  brokers: string[];
  groupId: string;
  topics: string;
}

export type MessageHandler = (
  event: KafkaEvent,
  rules: Awaited<ReturnType<typeof matchRules>>,
  recipients: Map<string, string>,
) => Promise<void>;

export async function createConsumer(
  config: ConsumerConfig,
  db: Database,
  onMatched?: MessageHandler,
): Promise<Consumer> {
  const kafka = getKafkaClient(config.brokers);
  const consumer = kafka.consumer({ groupId: config.groupId });

  await consumer.connect();

  try {
    await consumer.subscribe({ topics: [config.topics], fromBeginning: false });
  } catch (err) {
    logger.warn({ topic: config.topics, err }, 'topic subscription failed — will retry on reconnect');
  }

  await consumer.run({
    eachMessage: async ({ message }) => {
      const raw = message.value?.toString();
      if (!raw) {
        logger.error('empty message received — skipping');
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        logger.error({ raw: raw.slice(0, 200) }, 'malformed JSON — skipping');
        return;
      }

      const result = kafkaEventSchema.safeParse(parsed);
      if (!result.success) {
        logger.error({ issues: result.error.issues }, 'invalid event schema — skipping');
        return;
      }

      const event = result.data;

      // Validate tenant
      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, event.tenant_id))
        .limit(1);

      if (!tenant) {
        logger.warn({ tenantId: event.tenant_id }, 'unknown tenant — skipping');
        return;
      }

      if (!tenant.enabled) {
        logger.info({ tenantId: event.tenant_id }, 'disabled tenant — skipping');
        return;
      }

      // Match rules
      const rules = await matchRules(db, event.tenant_id, event.event_type);

      if (rules.length === 0) {
        logger.debug({ tenantId: event.tenant_id, eventType: event.event_type }, 'no matching rules');
        return;
      }

      // Resolve recipients
      const recipients = new Map<string, string>();
      for (const rule of rules) {
        const recipient = resolveRecipient(rule.recipientType, rule.recipientValue, event.payload);
        if (recipient) {
          recipients.set(rule.id, recipient);
        }
      }

      if (onMatched) {
        await onMatched(event, rules, recipients);
      }

      logger.info({
        eventId: event.event_id,
        tenantId: event.tenant_id,
        eventType: event.event_type,
        rulesMatched: rules.length,
      }, 'event processed');
    },
  });

  return consumer;
}
