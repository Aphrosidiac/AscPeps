import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { notifyIndexNow, productUrl } from '../../utils/indexnow.js';
import { notifyRevalidate } from '../../utils/revalidate.js';
import { flattenAddOn, ADDON_INCLUDE } from '../../utils/product-addons.js';

function checkSaleDateOrder(data: { saleStartsAt?: string | null; saleEndsAt?: string | null }, ctx: z.RefinementCtx) {
  if (data.saleStartsAt && data.saleEndsAt && new Date(data.saleStartsAt) > new Date(data.saleEndsAt)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['saleEndsAt'], message: 'Sale end date must be on or after the start date' });
  }
}

// One sellable SKU (size/strength) within a product's `variants` array.
// Every field besides `id` is `.optional()`, NOT `.default()` — the same
// partial-update-safety rule the parent schema below already documents:
// updating an existing variant (has `id`) with e.g. just `{ id, stock }`
// must leave every other field untouched, not silently reset it. A variant
// WITHOUT an `id` is a brand new one, so the refinement below requires
// `code`+`price` in that case only.
const variantObjectSchema = z.object({
  id: z.string().optional(),
  code: z.string().min(1).optional(),
  size: z.string().optional(),
  price: z.number().int().min(0).optional(),
  salePrice: z.number().int().min(0).nullable().optional(),
  saleStartsAt: z.string().datetime().nullable().optional(),
  saleEndsAt: z.string().datetime().nullable().optional(),
  stock: z.number().int().min(0).optional(),
  imageUrl: z.string().nullable().optional(),
  active: z.boolean().optional(),
}).superRefine((v, ctx) => {
  checkSaleDateOrder(v, ctx);
  if (!v.id && (v.code === undefined || v.price === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A new variant requires both code and price' });
  }
});

// Kept as a plain ZodObject (not wrapped in .superRefine) so .partial() below
// still works — ZodEffects (what .superRefine returns) doesn't have .partial().
const productObjectSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  categoryId: z.string().min(1),
  description: z.string().optional(),
  benefits: z.string().optional(),
  dosageInfo: z.string().optional(),
  coaUrl: z.string().nullable().optional(),
  featured: z.boolean().optional(),
  active: z.boolean().optional(),
  // Same `.optional()`-not-`.default()` rule as the variant schema above —
  // written/read by the Featured Order panel's frequent, narrow updates
  // (just `{ sortOrder }`), so it's exactly the field most exposed to the
  // silent-reset footgun if this were ever changed to `.default(0)`.
  sortOrder: z.number().int().optional(),
  // Full replacement set of add-ons for this product. Undefined leaves
  // existing add-ons untouched (partial update); [] clears them. `required`
  // force-selects and locks the add-on on the storefront (and is enforced
  // again server-side at order-creation time) regardless of which of this
  // product's own variants is purchased; `quantity` is the fixed amount
  // added — it does not scale with the purchased variant's quantity.
  addOns: z.array(z.object({
    addOnId: z.string(),
    required: z.boolean().default(false),
    quantity: z.number().int().min(1).default(1),
  })).optional(),
  // Plain-text nudge shown on the storefront near Add to Cart (e.g. "Needs
  // Bacteriostatic Water to reconstitute") — informational only, independent
  // of the required-add-on mechanism above. null clears it.
  addOnReminder: z.string().trim().max(300).nullable().optional(),
  // Full replacement set of variants (sizes/SKUs). Undefined leaves existing
  // variants untouched. Any existing variant not present in a submitted
  // array is soft-removed (active:false) — never a real delete, since a
  // variant already referenced by an order can't be hard-deleted (see
  // ProductVariant's Restrict FK on OrderItem).
  variants: z.array(variantObjectSchema).optional(),
});

// Sale dates now live entirely on ProductVariant (see variantObjectSchema's
// own superRefine above) — the parent has no date fields to cross-validate.
const createProductSchema = productObjectSchema;
const updateProductSchema = productObjectSchema.partial();

export async function adminListProducts(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);

  const where: Record<string, unknown> = {};
  if (query.category) where.categoryId = query.category;
  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: 'insensitive' } },
      { variants: { some: { code: { contains: query.search, mode: 'insensitive' } } } },
    ];
  }

  const [products, total] = await Promise.all([
    fastify.prisma.product.findMany({
      where,
      include: {
        category: { select: { name: true, slug: true } },
        // Admins manage inactive (discontinued) variants too, unlike the
        // public storefront which only ever shows active ones.
        variants: { orderBy: { price: 'asc' } },
        addOns: { include: ADDON_INCLUDE },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    fastify.prisma.product.count({ where }),
  ]);

  // Flatten the join rows — the admin form just wants a plain add-on list
  // with the join's required/quantity attached, same shape as the public
  // getProduct response.
  const flattened = products.map((p) => ({ ...p, addOns: p.addOns.map(flattenAddOn) }));

  return paginatedResponse(flattened, total, page, limit);
}

function toVariantSaleDates(v: z.infer<typeof variantObjectSchema>) {
  return {
    saleStartsAt: v.saleStartsAt ? new Date(v.saleStartsAt) : v.saleStartsAt,
    saleEndsAt: v.saleEndsAt ? new Date(v.saleEndsAt) : v.saleEndsAt,
  };
}

export async function adminCreateProduct(fastify: FastifyInstance, body: unknown) {
  const { addOns, variants, ...data } = createProductSchema.parse(body);

  const product = await fastify.prisma.$transaction(async (tx) => {
    const created = await tx.product.create({ data });

    if (variants && variants.length > 0) {
      await tx.productVariant.createMany({
        data: variants.map((v) => ({
          productId: created.id,
          code: v.code!,
          size: v.size,
          price: v.price!,
          salePrice: v.salePrice,
          ...toVariantSaleDates(v),
          stock: v.stock,
          imageUrl: v.imageUrl,
          active: v.active,
        })),
      });
    }

    if (addOns && addOns.length > 0) {
      await tx.productAddOn.createMany({
        data: addOns.map((a) => ({ productId: created.id, addOnId: a.addOnId, required: a.required, quantity: a.quantity })),
        skipDuplicates: true,
      });
    }
    return created;
  });

  notifyIndexNow([productUrl(product.slug)]);
  notifyRevalidate();
  return product;
}

export async function adminUpdateProduct(fastify: FastifyInstance, id: string, body: unknown) {
  const { addOns, variants, ...data } = updateProductSchema.parse(body);

  if (addOns && addOns.length > 0) {
    // A product's own variants can't be listed as its own add-ons — check
    // against variants it will end up with post-update (existing ones not
    // being removed, plus any newly submitted ones), not just its current set.
    const currentVariantIds = new Set(
      (await fastify.prisma.productVariant.findMany({ where: { productId: id }, select: { id: true } })).map((v) => v.id)
    );
    const ownVariantIds = variants === undefined
      ? currentVariantIds
      : new Set(variants.filter((v) => v.id).map((v) => v.id!));
    if (addOns.some((a) => ownVariantIds.has(a.addOnId))) {
      throw { statusCode: 400, message: "A product cannot list its own variant as its own add-on" };
    }
  }

  const product = await fastify.prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({ where: { id }, data });

    if (variants !== undefined) {
      const existing = await tx.productVariant.findMany({ where: { productId: id }, select: { id: true } });
      const existingIds = new Set(existing.map((v) => v.id));
      const submittedIds = new Set(variants.filter((v) => v.id).map((v) => v.id!));

      for (const v of variants) {
        if (v.id) {
          if (!existingIds.has(v.id)) {
            throw { statusCode: 400, message: `Variant ${v.id} does not belong to this product` };
          }
          await tx.productVariant.update({
            where: { id: v.id },
            data: {
              code: v.code, size: v.size, price: v.price, salePrice: v.salePrice,
              ...toVariantSaleDates(v), stock: v.stock, imageUrl: v.imageUrl, active: v.active,
            },
          });
        } else {
          await tx.productVariant.create({
            data: {
              productId: id,
              code: v.code!,
              size: v.size,
              price: v.price!,
              salePrice: v.salePrice,
              ...toVariantSaleDates(v),
              stock: v.stock,
              imageUrl: v.imageUrl,
              active: v.active,
            },
          });
        }
      }

      // Any existing variant not present in this submission is soft-removed
      // (never a real delete — see ProductVariant's Restrict FK on OrderItem).
      const removedIds = [...existingIds].filter((eid) => !submittedIds.has(eid));
      if (removedIds.length > 0) {
        await tx.productVariant.updateMany({ where: { id: { in: removedIds } }, data: { active: false } });
      }
    }

    if (addOns !== undefined) {
      await tx.productAddOn.deleteMany({ where: { productId: id } });
      if (addOns.length > 0) {
        await tx.productAddOn.createMany({
          data: addOns.map((a) => ({ productId: id, addOnId: a.addOnId, required: a.required, quantity: a.quantity })),
          skipDuplicates: true,
        });
      }
    }
    return updated;
  });

  notifyIndexNow([productUrl(product.slug)]);
  notifyRevalidate();
  return product;
}

export async function adminDeleteProduct(fastify: FastifyInstance, id: string) {
  // Soft-deletes the whole product line — its variants stay as they are
  // (still individually active/inactive) but the parent page 404s, which
  // is itself a useful signal for IndexNow-consuming crawlers to re-check.
  const product = await fastify.prisma.product.update({ where: { id }, data: { active: false } });
  notifyIndexNow([productUrl(product.slug)]);
  notifyRevalidate();
  return product;
}
