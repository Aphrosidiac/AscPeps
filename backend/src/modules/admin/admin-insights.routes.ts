import type { FastifyInstance } from 'fastify';
import {
  adminListInsights,
  adminGetInsight,
  adminCreateInsight,
  adminUpdateInsight,
  adminDeleteInsight,
} from './admin-insights.controller.js';

export default async function adminInsightRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.get('/', async (request) => adminListInsights(fastify, request.query as Record<string, string>));
  fastify.get<{ Params: { id: string } }>('/:id', async (request) => adminGetInsight(fastify, request.params.id));
  fastify.post('/', async (request) => adminCreateInsight(fastify, request.body));
  fastify.patch<{ Params: { id: string } }>('/:id', async (request) => adminUpdateInsight(fastify, request.params.id, request.body));
  fastify.delete<{ Params: { id: string } }>('/:id', async (request) => adminDeleteInsight(fastify, request.params.id));
}
