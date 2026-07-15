import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { notifyIndexNow, productUrl } from '../../utils/indexnow.js';

// Kept as a plain ZodObject (not wrapped in .superRefine) so .partial() below
// still works — ZodEffects (what .superRefine returns) doesn't have .partial().
const productObjectSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  categoryId: z.string().min(1),
  size: z.string().optional(),
  price: z.number().int().min(0),
  // Genuine time-limited sale — null clears it. isSaleActive() (product-pricing.ts)
  // requires all three to be set before treating the sale as active, so a
  // partial set (e.g. salePrice with no dates) is inert, not an error.
  salePrice: z.number().int().min(0).nullable().optional(),
  saleStartsAt: z.string().datetime().nullable().optional(),
  saleEndsAt: z.string().datetime().nullable().optional(),
  description: z.string().optional(),
  benefits: z.string().optional(),
  dosageInfo: z.string().optional(),
  stock: z.number().int().min(0).default(0),
  imageUrl: z.string().nullable().optional(),
  coaUrl: z.string().nullable().optional(),
  featured: z.boolean().default(false),
  active: z.boolean().default(true),
});

function checkSaleDateOrder(data: { saleStartsAt?: string | null; saleEndsAt?: string | null }, ctx: z.RefinementCtx) {
  if (data.saleStartsAt && data.saleEndsAt && new Date(data.saleStartsAt) > new Date(data.saleEndsAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['saleEndsAt'], message: 'Sale end date must be on or after the start date' });
  }
}

const createProductSchema = productObjectSchema.superRefine(checkSaleDateOrder);
const updateProductSchema = productObjectSchema.partial().superRefine(checkSaleDateOrder);

// Zod validates saleStartsAt/saleEndsAt as ISO strings (needed to run the
// ordering check above); Prisma's DateTime fields need actual Date objects.
// null clears the field, undefined leaves it untouched on a partial update.
function toSaleDates<T extends { saleStartsAt?: string | null; saleEndsAt?: string | null }>(data: T) {
  return {
    ...data,
    saleStartsAt: data.saleStartsAt ? new Date(data.saleStartsAt) : data.saleStartsAt,
    saleEndsAt: data.saleEndsAt ? new Date(data.saleEndsAt) : data.saleEndsAt,
  };
}

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
  const data = createProductSchema.parse(body);
  const product = await fastify.prisma.product.create({ data: toSaleDates(data) });
  notifyIndexNow([productUrl(product.slug)]);
  return product;
}

export async function adminUpdateProduct(fastify: FastifyInstance, id: string, body: unknown) {
  const data = updateProductSchema.parse(body);
  const product = await fastify.prisma.product.update({ where: { id }, data: toSaleDates(data) });
  notifyIndexNow([productUrl(product.slug)]);
  return product;
}

export async function adminDeleteProduct(fastify: FastifyInstance, id: string) {
  const product = await fastify.prisma.product.update({ where: { id }, data: { active: false } });
  // Product no longer resolves (active:false 404s), which is itself a
  // useful signal for IndexNow-consuming crawlers to re-check the URL.
  notifyIndexNow([productUrl(product.slug)]);
  return product;
}
