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
  // `.optional()`, NOT `.default()` — this schema is shared between create
  // and (via `.partial()`) update. A Zod `.default()` fires even when
  // `.partial()` makes the key optional, so a partial update that simply
  // omits `stock` (e.g. the admin table's inline-active-toggle, which only
  // sends `{ active }`) would silently reset it to 0 — verified this
  // actually happens, not theoretical. Omitted here, Prisma's own
  // `@default(...)` on the column fills in the value on create; on update
  // an omitted/undefined field is left untouched, which is what we want.
  stock: z.number().int().min(0).optional(),
  imageUrl: z.string().nullable().optional(),
  coaUrl: z.string().nullable().optional(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
  // Same `.optional()`-not-`.default()` rule as `stock` above — this is
  // written/read by the Featured Order panel's frequent, narrow updates
  // (just `{ sortOrder }`), so it's exactly the field most exposed to the
  // silent-reset footgun if this were ever changed to `.default(0)`.
  sortOrder: z.number().int().optional(),
  // Full replacement set of add-on product ids for this product. Undefined
  // leaves existing add-ons untouched (partial update); [] clears them.
  addOnIds: z.array(z.string()).optional(),
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
      include: {
        category: { select: { name: true, slug: true } },
        addOns: { include: { addOn: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    fastify.prisma.product.count({ where }),
  ]);

  // Flatten the join rows — the admin form just wants a plain Product[],
  // same shape as the public getProduct response.
  const flattened = products.map((p) => ({ ...p, addOns: p.addOns.map((row) => row.addOn) }));

  return paginatedResponse(flattened, total, page, limit);
}

export async function adminCreateProduct(fastify: FastifyInstance, body: unknown) {
  const { addOnIds, ...data } = createProductSchema.parse(body);

  const product = await fastify.prisma.$transaction(async (tx) => {
    const created = await tx.product.create({ data: toSaleDates(data) });
    if (addOnIds && addOnIds.length > 0) {
      await tx.productAddOn.createMany({
        data: addOnIds.map((addOnId) => ({ productId: created.id, addOnId })),
        skipDuplicates: true,
      });
    }
    return created;
  });

  notifyIndexNow([productUrl(product.slug)]);
  return product;
}

export async function adminUpdateProduct(fastify: FastifyInstance, id: string, body: unknown) {
  const { addOnIds, ...data } = updateProductSchema.parse(body);

  if (addOnIds?.includes(id)) {
    throw { statusCode: 400, message: 'A product cannot be its own add-on' };
  }

  const product = await fastify.prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({ where: { id }, data: toSaleDates(data) });
    if (addOnIds !== undefined) {
      await tx.productAddOn.deleteMany({ where: { productId: id } });
      if (addOnIds.length > 0) {
        await tx.productAddOn.createMany({
          data: addOnIds.map((addOnId) => ({ productId: id, addOnId })),
          skipDuplicates: true,
        });
      }
    }
    return updated;
  });

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
