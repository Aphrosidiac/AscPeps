import type { FastifyInstance } from 'fastify';
import { listInsights, getInsightBySlug } from './insights.controller.js';

export default async function insightRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request) => listInsights(fastify, request.query as Record<string, string>));
  fastify.get<{ Params: { slug: string } }>('/:slug', async (request) => getInsightBySlug(fastify, request.params.slug));
}
