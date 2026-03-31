import fp from 'fastify-plugin';
import { publishEventSchema } from './schemas.js';
import { ValidationError } from '../lib/errors.js';
import { publishEvent } from '../consumer/producer.js';

interface EventsRoutesOptions {
  kafkaBrokers: string[];
  kafkaTopics: string;
}

export const eventsRoutes = fp<EventsRoutesOptions>(async (app, opts) => {
  const { kafkaBrokers, kafkaTopics } = opts;

  app.post(
    '/api/events',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = publishEventSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new ValidationError('Invalid event data', parsed.error.issues.map((i) => i.message));
      }

      const { event_type, event_id, payload } = parsed.data;

      await publishEvent(kafkaBrokers, kafkaTopics, event_id, {
        tenant_id: request.tenantId,
        event_type,
        event_id,
        payload,
        timestamp: new Date().toISOString(),
      });

      return reply.status(200).send({ published: true });
    },
  );
});
