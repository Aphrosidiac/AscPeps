import type { FastifyInstance } from 'fastify';
import { login, getMe } from './auth.controller.js';

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/login', async (request) => {
    return login(fastify, request.body);
  });

  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request) => {
    return getMe(fastify, request.user.id);
  });
}
