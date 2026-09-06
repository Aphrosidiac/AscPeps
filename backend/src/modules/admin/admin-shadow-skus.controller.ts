import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { getVariantDisplayName } from '../../utils/product-addons.js';
import { generateInternalSummaryPdf } from '../../utils/internal-summary-pdf.js';
import {
  SHADOW_ITEM_INCLUDE,
  resolveShadowLines,
  shadowCoverage,
} from '../../utils/shadow-sku.js';

const shadowSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'A code is required')
    .max(40)
    // Scannable and searchable like a real SKU code, and unambiguous in a
    // filename. Deliberately narrow: a code with a space or a slash in it
    // stops being a code.
    .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore only'),
  name: z.string().trim().min(1, 'A name is required').max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  active: z.boolean().optional(),
});

const updateShadowSchema = shadowSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

const assignSchema = z.object({
  variantIds: z.array(z.string().min(1)).min(1).max(200),
  // Null unlinks — the variant survives, unmapped.
  shadowSkuId: z.string().min(1).nullable(),
});

// ---------------------------------------------------------------------------
// The shadow catalogue
// ---------------------------------------------------------------------------

export async function listShadowSkus(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);
  const search = query.search?.trim();

  const where = {
    ...(query.active === 'true' ? { active: true } : {}),
    ...(query.active === 'false' ? { active: false } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    fastify.prisma.shadowSku.findMany({
      where,
      orderBy: [{ active: 'desc' }, { code: 'asc' }],
      skip,
      take: limit,
      include: { _count: { select: { variants: true } } },
    }),
    fastify.prisma.shadowSku.count({ where }),
  ]);

  return paginatedResponse(
    rows.map(({ _count, ...row }) => ({ ...row, variantCount: _count.variants })),
    total,
    page,
    limit,
  );
}

export async function createShadowSku(fastify: FastifyInstance, body: unknown) {
  const data = shadowSchema.parse(body);
  const clash = await fastify.prisma.shadowSku.findUnique({ where: { code: data.code } });
  if (clash) throw { statusCode: 400, message: `Code ${data.code} is already in use.` };

  return fastify.prisma.shadowSku.create({
    data: { code: data.code, name: data.name, description: data.description ?? null, active: data.active ?? true },
  });
}

export async function updateShadowSku(fastify: FastifyInstance, id: string, body: unknown) {
  const data = updateShadowSchema.parse(body);
  const existing = await fastify.prisma.shadowSku.findUnique({ where: { id } });
  if (!existing) throw { statusCode: 404, message: 'Shadow SKU not found' };

  if (data.code && data.code !== existing.code) {
    const clash = await fastify.prisma.shadowSku.findUnique({ where: { code: data.code } });
    if (clash) throw { statusCode: 400, message: `Code ${data.code} is already in use.` };
  }

  return fastify.prisma.shadowSku.update({ where: { id }, data });
}

/**
 * Hard delete, allowed only while no variant still points at the row.
 * Deactivating is the gentler retirement path and keeps the code out of the
 * assignment dropdowns without disturbing anything already mapped.
 */
export async function deleteShadowSku(fastify: FastifyInstance, id: string) {
  const existing = await fastify.prisma.shadowSku.findUnique({ where: { id } });
  if (!existing) throw { statusCode: 404, message: 'Shadow SKU not found' };

  const variants = await fastify.prisma.productVariant.count({ where: { shadowSkuId: id } });

  if (variants > 0) {
    throw {
      statusCode: 400,
      message: `${existing.code} is still mapped to ${variants} SKU${variants === 1 ? '' : 's'}. Unmap them first, or deactivate it.`,
    };
  }

  await fastify.prisma.shadowSku.delete({ where: { id } });
  return { success: true };
}

// ---------------------------------------------------------------------------
// The mapping
// ---------------------------------------------------------------------------

export async function getCoverage(fastify: FastifyInstance) {
  return shadowCoverage(fastify);
}

/**
 * One row per real, sellable variant — because "what does this show up as?" is
 * the question with a direction. `unmapped=true` is the filter the coverage
 * strip links to.
 */
export async function listMapping(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);
  const search = query.search?.trim();

  const where = {
    ...(query.includeInactive === 'true' ? {} : { active: true }),
    ...(query.unmapped === 'true' ? { shadowSkuId: null } : {}),
    ...(query.shadowSkuId ? { shadowSkuId: query.shadowSkuId } : {}),
    ...(query.categoryId ? { product: { categoryId: query.categoryId } } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: 'insensitive' as const } },
            { product: { name: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    fastify.prisma.productVariant.findMany({
      where,
      orderBy: [{ product: { name: 'asc' } }, { code: 'asc' }],
      skip,
      take: limit,
      select: {
        id: true,
        code: true,
        size: true,
        active: true,
        shadowSkuId: true,
        product: { select: { id: true, name: true, categoryId: true } },
        shadowSku: { select: { id: true, code: true, name: true, active: true } },
        _count: { select: { orderItems: true } },
      },
    }),
    fastify.prisma.productVariant.count({ where }),
  ]);

  return paginatedResponse(
    rows.map(({ _count, ...row }) => ({
      ...row,
      displayName: getVariantDisplayName(row.product, row),
      orderLineCount: _count.orderItems,
    })),
    total,
    page,
    limit,
  );
}

/** Bulk assign or unassign. One shadow across many SKUs is the common case. */
export async function assignMapping(fastify: FastifyInstance, body: unknown) {
  const data = assignSchema.parse(body);

  if (data.shadowSkuId) {
    const shadow = await fastify.prisma.shadowSku.findUnique({ where: { id: data.shadowSkuId } });
    if (!shadow) throw { statusCode: 400, message: 'That shadow SKU does not exist.' };
    if (!shadow.active) {
      throw { statusCode: 400, message: `${shadow.code} is inactive. Reactivate it before mapping to it.` };
    }
  }

  const found = await fastify.prisma.productVariant.count({ where: { id: { in: data.variantIds } } });
  if (found !== data.variantIds.length) {
    throw { statusCode: 400, message: 'One or more SKUs do not exist.' };
  }

  const result = await fastify.prisma.productVariant.updateMany({
    where: { id: { in: data.variantIds } },
    data: { shadowSkuId: data.shadowSkuId },
  });

  return { updated: result.count };
}

// ---------------------------------------------------------------------------
// The internal summary for one order
// ---------------------------------------------------------------------------

/**
 * Every order with its sheet status: which ones can produce a sheet and which
 * are blocked on an unmapped SKU.
 *
 * Both states are expressed as Prisma filters rather than computed after
 * fetching, so paging and the total count stay correct — filtering a page in
 * memory would report "12 blocked" while meaning "12 on this page".
 */
export async function listOrderSummaries(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);
  const search = query.search?.trim();

  const unresolvable = { variant: { shadowSkuId: null } };

  const stateWhere =
    query.state === 'blocked'
      ? { items: { some: unresolvable } }
      : query.state === 'ready'
        ? { items: { none: unresolvable } }
        : {};

  const where = {
    deletedAt: null,
    ...stateWhere,
    ...(search ? { orderNumber: { contains: search, mode: 'insensitive' as const } } : {}),
  };

  const [orders, total] = await Promise.all([
    fastify.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        orderNumber: true,
        createdAt: true,
        total: true,
        status: true,
        paymentStatus: true,
        items: { include: SHADOW_ITEM_INCLUDE },
      },
    }),
    fastify.prisma.order.count({ where }),
  ]);

  return paginatedResponse(
    orders.map(({ items, ...order }) => {
      const resolution = resolveShadowLines(items);
      return {
        ...order,
        lineCount: items.length,
        complete: resolution.complete,
        unmappedCount: resolution.unmapped.length,
      };
    }),
    total,
    page,
    limit,
  );
}

async function loadOrderForSummary(fastify: FastifyInstance, orderRef: string) {
  const order = await fastify.prisma.order.findFirst({
    where: { OR: [{ id: orderRef }, { orderNumber: orderRef }], deletedAt: null },
    include: { items: { include: SHADOW_ITEM_INCLUDE } },
  });
  if (!order) throw { statusCode: 404, message: 'Order not found' };
  return order;
}

/**
 * The order in shadow wording, with the real names alongside so the admin can
 * see the mapping being applied. Pure read — this is what both the order page
 * and the backlog's detail view render on open.
 */
export async function previewOrderSummary(fastify: FastifyInstance, orderRef: string) {
  const order = await loadOrderForSummary(fastify, orderRef);
  const resolution = resolveShadowLines(order.items);

  return {
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      subtotal: order.subtotal,
      shippingFee: order.shippingFee,
      discountAmount: order.discountAmount,
      total: order.total,
      status: order.status,
      paymentStatus: order.paymentStatus,
    },
    ...resolution,
  };
}

/**
 * Render the sheet. A pure read like everything else here — it can be asked for
 * as often as anyone likes, and always reflects the mapping as it stands now.
 */
export async function streamOrderSummaryPdf(
  fastify: FastifyInstance,
  orderRef: string,
  reply: FastifyReply,
) {
  const order = await loadOrderForSummary(fastify, orderRef);
  const resolution = resolveShadowLines(order.items);

  if (!resolution.complete) {
    const names = resolution.unmapped.map((u) => `${u.realName} (${u.realCode})`).join(', ');
    throw {
      statusCode: 400,
      message: `Cannot produce a summary: ${resolution.unmapped.length} item${resolution.unmapped.length === 1 ? ' has' : 's have'} no shadow SKU — ${names}. Map them first.`,
    };
  }

  const settings = await fastify.prisma.setting.findMany({
    where: { key: { in: ['business_name', 'receipt_company_name'] } },
  });
  const byKey = Object.fromEntries(settings.map((s) => [s.key, s.value]));
  const businessName = byKey.receipt_company_name || byKey.business_name || 'Ascend MY';

  const pdf = await generateInternalSummaryPdf(order, resolution.lines, businessName);

  // The filename says what it is. Nobody should have to open it to find out
  // this is not the receipt.
  //
  // Order numbers carry a slash (ASC2608/0022), which is a path separator and
  // has no business in a Content-Disposition filename — it is stripped rather
  // than encoded so the saved file is still recognisably its order.
  const safeNumber = order.orderNumber.replace(/[^A-Za-z0-9._-]+/g, '-');
  reply.header('Content-Type', 'application/pdf');
  reply.header('Content-Disposition', `attachment; filename="${safeNumber}-internal-summary.pdf"`);
  return reply.send(pdf);
}
