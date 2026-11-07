import type { FastifyInstance } from 'fastify';
import { getDashboardStats, getAnalytics } from './admin-dashboard.controller.js';
import { getMonthlyAnalytics } from './admin-analytics.controller.js';

export default async function adminDashboardRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/stats', async () => {
    return getDashboardStats(fastify);
  });

  fastify.get('/analytics/monthly', async (request) => {
    return getMonthlyAnalytics(fastify, request.query as { from?: string; to?: string });
  });

  fastify.get('/analytics', async (request) => {
    return getAnalytics(fastify, request.query as { days?: string });
  });
}
