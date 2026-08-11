import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';

// The optional fields are `.nullish()`, not `.optional()`, and the difference
// is the whole bug: zod's `.optional()` accepts `undefined` but REJECTS `null`,
// and the admin form posts an explicit null for every field left blank. That
// made the simplest possible discount — a code and a percentage, no minimum, no
// cap, no expiry — the one combination that could never be created.
//
// Fixing it here rather than making the form omit the keys is deliberate: on
// update, omitted means "leave alone" and null means "clear it", so the form
// needs to be able to send null to remove an expiry it set earlier.
const createDiscountSchema = z.object({
  code: z.string().min(1).transform((v) => v.toUpperCase().trim()),
  description: z.string().nullish(),
  discountType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
  discountValue: z.number().int().min(1),
  minOrderAmount: z.number().int().min(0).nullish(),
  maxUses: z.number().int().min(1).nullish(),
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime().nullish(),
});

const updateDiscountSchema = createDiscountSchema.partial();

export async function adminListDiscounts(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);

  const where: Record<string, unknown> = {};
  if (query.search) {
    where.OR = [
      { code: { contains: query.search, mode: 'insensitive' } },
      { description: { contains: query.search, mode: 'insensitive' } },
    ];
  }

  const [discounts, total] = await Promise.all([
    fastify.prisma.discountCode.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    fastify.prisma.discountCode.count({ where }),
  ]);

  return paginatedResponse(discounts, total, page, limit);
}

export async function adminCreateDiscount(fastify: FastifyInstance, body: unknown) {
  const data = createDiscountSchema.parse(body);
  const existing = await fastify.prisma.discountCode.findUnique({ where: { code: data.code } });
  if (existing) throw { statusCode: 400, message: 'Discount code already exists' };

  return fastify.prisma.discountCode.create({
    data: {
      ...data,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    },
  });
}

export async function adminUpdateDiscount(fastify: FastifyInstance, id: string, body: unknown) {
  const data = updateDiscountSchema.parse(body);
  // The key is added ONLY when the caller sent one, rather than being set to
  // `undefined` when they didn't. Passing an explicit undefined here cleared
  // the column instead of being ignored, so editing a discount's description
  // silently wiped its expiry date. Same shape as the `.partial()` + `.default()`
  // footgun that reset `featured` on every inline stock edit — an update schema
  // that cannot distinguish "absent" from "empty" will always find a way to
  // destroy data.
  // Note the test is `!== undefined`, not `'expiresAt' in data`: zod's
  // .partial() emits the key with an undefined VALUE rather than omitting it,
  // so an `in` check is true even when the caller sent nothing — which is how
  // the first attempt at this fix still wiped the date.
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) patch[k] = v;
  if (data.expiresAt !== undefined) {
    patch.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
  }

  return fastify.prisma.discountCode.update({ where: { id }, data: patch });
}

export async function adminDeleteDiscount(fastify: FastifyInstance, id: string) {
  const used = await fastify.prisma.order.count({ where: { discountCodeId: id } });
  if (used > 0) {
    return fastify.prisma.discountCode.update({ where: { id }, data: { isActive: false } });
  }
  return fastify.prisma.discountCode.delete({ where: { id } });
}

export async function validateDiscountCode(fastify: FastifyInstance, code: string, subtotal: number) {
  const discount = await fastify.prisma.discountCode.findUnique({ where: { code: code.toUpperCase().trim() } });

  if (!discount) throw { statusCode: 404, message: 'Invalid discount code' };
  if (!discount.isActive) throw { statusCode: 400, message: 'This discount code is no longer active' };
  if (discount.expiresAt && discount.expiresAt < new Date()) throw { statusCode: 400, message: 'This discount code has expired' };
  if (discount.maxUses && discount.usedCount >= discount.maxUses) throw { statusCode: 400, message: 'This discount code has reached its usage limit' };
  if (discount.minOrderAmount && subtotal < discount.minOrderAmount) {
    throw { statusCode: 400, message: `Minimum order of RM${(discount.minOrderAmount / 100).toFixed(2)} required` };
  }

  let discountAmount: number;
  if (discount.discountType === 'PERCENTAGE') {
    discountAmount = Math.round(subtotal * discount.discountValue / 100);
  } else {
    discountAmount = Math.min(discount.discountValue, subtotal);
  }

  return { discount, discountAmount };
}
