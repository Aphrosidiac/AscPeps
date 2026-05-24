import type { FastifyInstance } from 'fastify';
import { listCategories } from './categories.controller.js';

export default async function categoryRoutes(fastify: FastifyInstance) {
  fastify.get('/', async () => {
    return listCategories(fastify);
  });
}
