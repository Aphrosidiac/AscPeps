import type { FastifyInstance } from 'fastify';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';

export async function listInsights(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);

  const where: Record<string, unknown> = { published: true };
  if (query.category) where.category = query.category;

  const [insights, total] = await Promise.all([
    fastify.prisma.insight.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      skip,
      take: limit,
    }),
    fastify.prisma.insight.count({ where }),
  ]);

  return paginatedResponse(insights, total, page, limit);
}

export async function getInsightBySlug(fastify: FastifyInstance, slug: string) {
  const insight = await fastify.prisma.insight.findFirst({
    where: { slug, published: true },
    include: { figures: { orderBy: { order: 'asc' } } },
  });
  if (!insight) {
    throw { statusCode: 404, message: 'Insight not found' };
  }

  // Excludes hidden/discontinued products so a "mentioned in this article"
  // chip never links to a page that no longer exists on the storefront.
  const relatedProducts = insight.relatedProductIds.length > 0
    ? await fastify.prisma.product.findMany({
        where: { id: { in: insight.relatedProductIds }, active: true, addOnOnly: false },
        select: { id: true, name: true, slug: true },
      })
    : [];

  return { ...insight, relatedProducts };
}
