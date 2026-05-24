import type { FastifyInstance } from 'fastify';
import { getDashboardStats } from './admin-dashboard.controller.js';

export default async function adminDashboardRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/stats', async () => {
    return getDashboardStats(fastify);
  });
}
