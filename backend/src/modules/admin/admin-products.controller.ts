import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';

const productSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  categoryId: z.string().min(1),
  size: z.string().optional(),
  price: z.number().int().min(0),
  description: z.string().optional(),
  benefits: z.string().optional(),
  dosageInfo: z.string().optional(),
  stock: z.number().int().min(0).default(0),
  imageUrl: z.string().optional(),
  active: z.boolean().default(true),
});

export async function adminListProducts(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);

  const where: Record<string, unknown> = {};
  if (query.category) where.categoryId = query.category;
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { code: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [products, total] = await Promise.all([
    fastify.prisma.product.findMany({
      where,
      include: { category: { select: { name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    fastify.prisma.product.count({ where }),
  ]);

  return paginatedResponse(products, total, page, limit);
}

export async function adminCreateProduct(fastify: FastifyInstance, body: unknown) {
  const data = productSchema.parse(body);
  return fastify.prisma.product.create({ data });
}

export async function adminUpdateProduct(fastify: FastifyInstance, id: string, body: unknown) {
  const data = productSchema.partial().parse(body);
  return fastify.prisma.product.update({ where: { id }, data });
}

export async function adminDeleteProduct(fastify: FastifyInstance, id: string) {
  return fastify.prisma.product.update({ where: { id }, data: { active: false } });
}
