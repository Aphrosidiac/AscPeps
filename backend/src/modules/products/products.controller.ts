import type { FastifyInstance } from 'fastify';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';

export async function listProducts(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);

  const where: Record<string, unknown> = { active: true };

  if (query.featured === 'true') {
    where.featured = true;
  }

  if (query.category) {
    where.category = { slug: query.category };
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { code: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [products, total] = await Promise.all([
    fastify.prisma.product.findMany({
      where,
      include: { category: { select: { name: true, slug: true } } },
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
    fastify.prisma.product.count({ where }),
  ]);

  return paginatedResponse(products, total, page, limit);
}

export async function getProduct(fastify: FastifyInstance, slug: string) {
  const product = await fastify.prisma.product.findUnique({
    where: { slug, active: true },
    include: { category: { select: { name: true, slug: true } } },
  });

  if (!product) {
    throw { statusCode: 404, message: 'Product not found' };
  }

  return product;
}
