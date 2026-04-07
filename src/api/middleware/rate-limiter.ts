import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

export const rateLimiterPlugin = fp(async (app) => {
  await app.register(rateLimit, {
    global: false,
    max: 200,
    timeWindow: '1 minute',
  });
});
