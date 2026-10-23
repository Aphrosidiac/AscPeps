import type { FastifyInstance } from 'fastify';
import { getPaymentAnalytics } from './admin-payments.controller.js';

export default async function adminPaymentRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/analytics', async (request) => {
    return getPaymentAnalytics(fastify, request.query);
  });
}
