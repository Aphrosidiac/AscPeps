import type { FastifyInstance } from 'fastify';
import { listResearch, getResearchBySlug } from './research.controller.js';

export default async function researchRoutes(fastify: FastifyInstance) {
  fastify.get('/', async () => listResearch(fastify));
  fastify.get<{ Params: { slug: string } }>('/:slug', async (request) => getResearchBySlug(fastify, request.params.slug));
}
