import type { FastifyInstance } from 'fastify';
import { login, getMe } from './auth.controller.js';

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request) => {
      return login(fastify, request.body);
    }
  );

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request) => {
    return getMe(fastify, request.user.id);
  });
}
