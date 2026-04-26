import fp from 'fastify-plugin';
import { eq } from 'drizzle-orm';
import { publishEventSchema } from './schemas.js';
import { ValidationError } from '../lib/errors.js';
import { publishEvent } from '../consumer/producer.js';
import { matchRules, resolveRecipient } from '../consumer/router.js';
import { processNotification } from '../processor/pipeline.js';
import { tenants } from '../db/schema.js';
import { createLogger } from '../lib/logger.js';
import { resolveTenantEventsRateLimit } from './middleware/rate-limiter.js';
import type { Database } from '../db/client.js';

const logger = createLogger('events');

interface EventsRoutesOptions {
  db: Database;
  kafkaBrokers?: string[];
  kafkaTopics?: string;
  useKafka: boolean;
  pipelineConfig: {
    dedupWindowMinutes: number;
    digestSchedule: 'hourly' | 'daily' | 'weekly';
    dispatch: Record<string, unknown>;
  };
}

export const eventsRoutes = fp<EventsRoutesOptions>(async (app, opts) => {
  const { db, kafkaBrokers, kafkaTopics, useKafka, pipelineConfig } = opts;

  app.post(
    '/api/events',
    {
      config: {
        rateLimit: {
          // Phase 7 H7 — per-tenant configurable rate limit.
          // `keyGenerator` scopes the bucket to the authenticated tenant
          // (NOT the IP), and `max` resolves dynamically from
          // `tenants.config.rate_limits.events_per_minute` via the
          // resolver helper. We use `hook: 'preHandler'` so this rate
          // check runs AFTER `authPlugin`'s `onRequest` has attached
          // `request.tenant` / `request.tenantId`. The default
          // `onRequest` hook would fire too early — auth wouldn't have
          // resolved the tenant yet, max would always default.
          hook: 'preHandler' as const,
          max: (request: { tenant?: { config: Record<string, unknown> | null } | null }) => {
            return resolveTenantEventsRateLimit(request.tenant ?? null);
          },
          keyGenerator: (request: { tenantId?: string; ip?: string }) => {
            return request.tenantId ?? request.ip ?? 'anonymous';
          },
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const parsed = publishEventSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid event data', parsed.error.issues.map((i) => i.message));
      }

      const { event_type, event_id, payload } = parsed.data;
      const tenantId = request.tenantId;

      if (useKafka && kafkaBrokers && kafkaTopics) {
        // Kafka mode — publish to topic, consumer handles processing
        await publishEvent(kafkaBrokers, kafkaTopics, event_id, {
          tenant_id: tenantId,
          event_type,
          event_id,
          payload,
          timestamp: new Date().toISOString(),
        });
      } else {
        // Direct mode — process inline, no Kafka needed
        const [tenant] = await db
          .select()
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .limit(1);

        const rules = await matchRules(db, tenantId, event_type);

        if (rules.length === 0) {
          logger.debug({ tenantId, event_type }, 'no matching rules');
          return reply.status(200).send({ published: true, processed: 0 });
        }

        const event = {
          tenant_id: tenantId,
          event_type,
          event_id,
          payload,
          timestamp: new Date().toISOString(),
        };

        const tenantConfig = (tenant?.config as Record<string, unknown>) ?? null;
        const config = {
          ...pipelineConfig,
          dispatch: { ...pipelineConfig.dispatch, tenantConfig },
          tenantConfig,
        };

        let processed = 0;
        for (const rule of rules) {
          const recipient = resolveRecipient(rule.recipientType, rule.recipientValue, payload);
          if (recipient) {
            await processNotification(db, event, rule, recipient, config);
            processed++;
          }
        }

        logger.info({ tenantId, event_type, event_id, rulesMatched: rules.length, processed }, 'event processed directly');
        return reply.status(200).send({ published: true, processed });
      }

      return reply.status(200).send({ published: true });
    },
  );
});
