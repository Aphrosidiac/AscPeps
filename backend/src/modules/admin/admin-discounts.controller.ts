import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';

const createDiscountSchema = z.object({
  code: z.string().min(1).transform((v) => v.toUpperCase().trim()),
  description: z.string().optional(),
  discountType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
  discountValue: z.number().int().min(1),
  minOrderAmount: z.number().int().min(0).optional(),
  maxUses: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
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
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    },
  });
}

export async function adminUpdateDiscount(fastify: FastifyInstance, id: string, body: unknown) {
  const data = updateDiscountSchema.parse(body);
  return fastify.prisma.discountCode.update({
    where: { id },
    data: {
      ...data,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
    },
  });
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
