import type { FastifyInstance } from 'fastify';

export async function listCategories(fastify: FastifyInstance) {
  const categories = await fastify.prisma.category.findMany({
    orderBy: { sortOrder: 'asc' },
    include: { _count: { select: { products: { where: { active: true } } } } },
  });

  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    productCount: c._count.products,
  }));
}
