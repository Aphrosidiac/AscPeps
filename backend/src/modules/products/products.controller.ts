import type { FastifyInstance } from 'fastify';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { flattenAddOn, ADDON_INCLUDE } from '../../utils/product-addons.js';

export async function listProducts(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);

  // addOnOnly products (e.g. a free syringe bundled with a peptide) never
  // appear in the general catalog — only ever reachable as another
  // product's add-on, never their own browsable listing.
  const where: Record<string, unknown> = { active: true, addOnOnly: false };

  if (query.featured === 'true') {
    where.featured = true;
  }

  if (query.category) {
    where.category = { slug: query.category };
  }

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
      { variants: { some: { code: { contains: query.search, mode: 'insensitive' } } } },
    ];
  }

  const [products, total] = await Promise.all([
    fastify.prisma.product.findMany({
      where,
      include: {
        category: { select: { name: true, slug: true } },
        variants: { where: { active: true }, orderBy: { price: 'asc' } },
      },
      orderBy: [{ featured: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
    fastify.prisma.product.count({ where }),
  ]);

  return paginatedResponse(products, total, page, limit);
}

export async function getProduct(fastify: FastifyInstance, slug: string) {
  // addOnOnly products have no reachable page of their own, even by direct
  // URL — same reasoning as listProducts above.
  const product = await fastify.prisma.product.findUnique({
    where: { slug, active: true, addOnOnly: false },
    include: {
      category: { select: { name: true, slug: true } },
      variants: { where: { active: true }, orderBy: { price: 'asc' } },
      // An add-on's own parent product must also be active — otherwise a
      // soft-deleted product could still be shown (and added to cart) as
      // someone else's add-on, only to fail the whole order at checkout.
      addOns: { where: { addOn: { active: true, product: { active: true } } }, include: ADDON_INCLUDE },
    },
  });

  if (!product) {
    throw { statusCode: 404, message: 'Product not found' };
  }

  return { ...product, addOns: product.addOns.map(flattenAddOn) };
}
