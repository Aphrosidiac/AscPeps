import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getVariantDisplayName } from '../../utils/product-addons.js';

// Who the business buys from and what each of them charges per SKU. A price
// list and nothing more — see the Supplier model comment. The order costing
// sheet reads it to offer "YL,C · RM65.00" in a dropdown instead of a blank box.

const supplierSchema = z.object({
  // Short, the way the partners say it. Commas and dots are allowed ("YL,C")
  // because that IS the name; only whitespace is normalised.
  name: z.string().trim().min(1, 'A name is required').max(60),
  active: z.boolean().optional(),
});

const updateSupplierSchema = supplierSchema
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

// Cents. Same cap as an order's money fields.
const costCents = z.number().int().min(0).max(100_000_000);

const setCostsSchema = z.object({
  costs: z
    .array(
      z.object({
        supplierId: z.string().min(1),
        variantId: z.string().min(1),
        // Null removes the price: "this supplier does not sell this any more".
        cost: costCents.nullable(),
      })
    )
    .min(1)
    .max(2000),
});

const SUPPLIER_SELECT = {
  id: true,
  name: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { costs: true, orderItems: true } },
} as const;

function shape<T extends { _count: { costs: number; orderItems: number } }>(row: T) {
  const { _count, ...rest } = row;
  return { ...rest, priceCount: _count.costs, orderLineCount: _count.orderItems };
}

// Names are compared case-insensitively so "chris" and "Chris" cannot both
// exist — the dropdown would show two people where there is one.
async function findByName(fastify: FastifyInstance, name: string) {
  return fastify.prisma.supplier.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export async function listSuppliers(fastify: FastifyInstance) {
  const rows = await fastify.prisma.supplier.findMany({
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    select: SUPPLIER_SELECT,
  });
  return rows.map(shape);
}

export async function createSupplier(fastify: FastifyInstance, body: unknown) {
  const data = supplierSchema.parse(body);
  const clash = await findByName(fastify, data.name);
  if (clash) throw { statusCode: 400, message: `${clash.name} is already on the list.` };

  const row = await fastify.prisma.supplier.create({
    data: { name: data.name, active: data.active ?? true },
    select: SUPPLIER_SELECT,
  });
  return shape(row);
}

export async function updateSupplier(fastify: FastifyInstance, id: string, body: unknown) {
  const data = updateSupplierSchema.parse(body);
  const existing = await fastify.prisma.supplier.findUnique({ where: { id } });
  if (!existing) throw { statusCode: 404, message: 'Supplier not found' };

  if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
    const clash = await findByName(fastify, data.name);
    if (clash) throw { statusCode: 400, message: `${clash.name} is already on the list.` };
  }

  const row = await fastify.prisma.supplier.update({ where: { id }, data, select: SUPPLIER_SELECT });
  return shape(row);
}

/**
 * Hard delete, allowed only while no order line names the supplier. Their
 * prices go with them (cascade) — a price list entry means nothing without
 * the person. Deactivating is the retirement path once they have history.
 */
export async function deleteSupplier(fastify: FastifyInstance, id: string) {
  const existing = await fastify.prisma.supplier.findUnique({
    where: { id },
    select: { name: true, _count: { select: { orderItems: true } } },
  });
  if (!existing) throw { statusCode: 404, message: 'Supplier not found' };

  const lines = existing._count.orderItems;
  if (lines > 0) {
    throw {
      statusCode: 400,
      message: `${existing.name} is recorded on ${lines} costed order line${lines === 1 ? '' : 's'}. Deactivate them instead — the history stays.`,
    };
  }

  await fastify.prisma.supplier.delete({ where: { id } });
  return { success: true };
}

// ---------------------------------------------------------------------------
// The price sheet
// ---------------------------------------------------------------------------

/**
 * Every sellable SKU against every supplier: the whole list in one read,
 * because the page that edits it IS a sheet — rows of products, a column per
 * supplier — and the catalogue is a few dozen lines, not thousands.
 *
 * Inactive SKUs are left out (nothing new is costed against them), inactive
 * suppliers are included and flagged so the page can hide their column
 * without the prices behind it vanishing.
 */
export async function getPriceSheet(fastify: FastifyInstance) {
  const [suppliers, variants] = await Promise.all([
    fastify.prisma.supplier.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, active: true },
    }),
    fastify.prisma.productVariant.findMany({
      where: { active: true, product: { active: true } },
      orderBy: [{ product: { name: 'asc' } }, { createdAt: 'asc' }],
      select: {
        id: true,
        code: true,
        size: true,
        product: { select: { id: true, name: true } },
        supplierCosts: { select: { supplierId: true, cost: true } },
      },
    }),
  ]);

  return {
    suppliers,
    rows: variants.map((v) => ({
      variantId: v.id,
      code: v.code,
      size: v.size,
      productId: v.product.id,
      productName: v.product.name,
      displayName: getVariantDisplayName(v.product, v),
      costs: Object.fromEntries(v.supplierCosts.map((c) => [c.supplierId, c.cost])),
    })),
  };
}

/** Bulk upsert. A null cost deletes the pair; a missing pair is untouched. */
export async function setSupplierCosts(fastify: FastifyInstance, body: unknown) {
  const { costs } = setCostsSchema.parse(body);

  const supplierIds = [...new Set(costs.map((c) => c.supplierId))];
  const variantIds = [...new Set(costs.map((c) => c.variantId))];
  const [suppliers, variants] = await Promise.all([
    fastify.prisma.supplier.count({ where: { id: { in: supplierIds } } }),
    fastify.prisma.productVariant.count({ where: { id: { in: variantIds } } }),
  ]);
  if (suppliers !== supplierIds.length) throw { statusCode: 400, message: 'One or more suppliers do not exist.' };
  if (variants !== variantIds.length) throw { statusCode: 400, message: 'One or more SKUs do not exist.' };

  await fastify.prisma.$transaction(
    costs.map((c) =>
      c.cost === null
        ? fastify.prisma.supplierCost.deleteMany({ where: { supplierId: c.supplierId, variantId: c.variantId } })
        : fastify.prisma.supplierCost.upsert({
            where: { supplierId_variantId: { supplierId: c.supplierId, variantId: c.variantId } },
            create: { supplierId: c.supplierId, variantId: c.variantId, cost: c.cost },
            update: { cost: c.cost },
          })
    )
  );

  return { updated: costs.length };
}

/**
 * The dropdown's contents for a set of SKUs — what the order page asks for.
 * Active suppliers with a price for that SKU, cheapest first so the eye lands
 * on the best figure; an inactive supplier is left out here even if priced,
 * because nothing new should be bought from them.
 */
export async function getSupplierOptions(fastify: FastifyInstance, variantIds: string[]) {
  const ids = [...new Set(variantIds.map((s) => s.trim()).filter(Boolean))].slice(0, 100);
  if (!ids.length) return {};

  const rows = await fastify.prisma.supplierCost.findMany({
    where: { variantId: { in: ids }, supplier: { active: true } },
    orderBy: [{ cost: 'asc' }, { supplier: { name: 'asc' } }],
    select: { variantId: true, supplierId: true, cost: true, supplier: { select: { name: true } } },
  });

  const out: Record<string, { supplierId: string; name: string; cost: number }[]> = Object.fromEntries(ids.map((id) => [id, []]));
  for (const r of rows) out[r.variantId].push({ supplierId: r.supplierId, name: r.supplier.name, cost: r.cost });
  return out;
}
