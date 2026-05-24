import type { FastifyInstance } from 'fastify';
import { listProducts, getProduct } from './products.controller.js';

export default async function productRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (request) => {
    const query = request.query as Record<string, string>;
    return listProducts(fastify, query);
  });

  fastify.get<{ Params: { slug: string } }>('/:slug', async (request) => {
    return getProduct(fastify, request.params.slug);
  });
}
