import type { AgentTool } from '../tool-kit.js';
import { money, rm, toCents } from '../tool-kit.js';
import {
  createSupplier,
  getPriceSheet,
  listSuppliers,
  setSupplierCosts,
} from '../../admin/admin-suppliers.controller.js';

/**
 * The supplier price list, over chat: who the business buys from and what each
 * of them charges per SKU. Reads answer "what does Chris charge for Reta
 * 10mg?"; the two writes keep the list current without opening the admin.
 *
 * Nothing here touches an order. Costing an order line from the list is
 * `set_order_costs` with a `supplier` on the line — that tool copies the price
 * onto the order and records whose it was.
 */

// A supplier by name, forgiving about case. Refuses with the real list rather
// than guessing between "YL" and "YL,C".
export async function resolveSupplier(fastify: any, name: string) {
  const all = await listSuppliers(fastify);
  const raw = String(name ?? '').trim().toLowerCase();
  if (!raw) throw new Error('Which supplier? Name one of: ' + all.map((s) => s.name).join(', '));
  const exact = all.find((s) => s.name.toLowerCase() === raw);
  if (exact) return exact;
  const partial = all.filter((s) => s.name.toLowerCase().includes(raw));
  if (partial.length === 1) return partial[0];
  throw new Error(
    partial.length
      ? `"${name}" could be ${partial.map((s) => s.name).join(' or ')}. Ask which one.`
      : `No supplier called "${name}". The list is: ${all.map((s) => s.name).join(', ') || '(empty)'}. Use add_supplier to add one.`
  );
}

async function resolveVariantByCode(prisma: any, code: string) {
  const variant = await prisma.productVariant.findFirst({
    where: { code: { equals: String(code ?? '').trim(), mode: 'insensitive' } },
    include: { product: true },
  });
  if (!variant) throw new Error(`No SKU with code "${code}". Use search_products to find the right size.`);
  return variant;
}

export const supplierTools: AgentTool[] = [
  {
    name: 'list_suppliers',
    description:
      'The supplier price list: every supplier, and what each charges per unit for each SKU. Filter by a product name or SKU code to see one item\'s prices side by side. Prices are per unit, in RINGGIT.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'A product name or SKU code. Omit for the whole list.' },
        includeInactive: { type: 'boolean', description: 'Also show retired suppliers. Default false.' },
      },
    },
    run: async ({ fastify }, input) => {
      const sheet = await getPriceSheet(fastify);
      const suppliers = sheet.suppliers.filter((s) => input.includeInactive || s.active);
      // Word by word, not as one substring: operators write "reta 10mg" for
      // "Retatrutide 10mg", and every word has to land somewhere in the name
      // or the code.
      const words = String(input.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const rows = sheet.rows.filter((r) => {
        const hay = `${r.displayName} ${r.code}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
      const q = words.join(' ');
      const byId = new Map(suppliers.map((s) => [s.id, s.name]));
      return {
        suppliers: suppliers.map((s) => ({ name: s.name, active: s.active })),
        prices: rows
          .map((r) => ({
            sku: r.code,
            item: r.displayName,
            perUnit: Object.fromEntries(
              Object.entries(r.costs)
                .filter(([id]) => byId.has(id))
                .map(([id, cost]) => [byId.get(id), money(cost)])
            ),
          }))
          .filter((r) => !q || Object.keys(r.perUnit).length > 0 || rows.length <= 10),
        note: 'A SKU missing from a supplier\'s column means they do not sell it — not that it is free.',
      };
    },
  },

  {
    name: 'add_supplier',
    description: 'Add a supplier to the price list by name. Prices are set separately with set_supplier_cost.',
    write: true,
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Short, as the partners say it: "Chris", "YL,C".' } },
      required: ['name'],
    },
    run: async ({ fastify }, input) => {
      const row = await createSupplier(fastify, { name: String(input.name ?? '') });
      return { added: row.name, note: 'No prices yet — set_supplier_cost adds one per SKU.' };
    },
  },

  {
    name: 'set_supplier_cost',
    description:
      'Set (or remove) what one supplier charges per unit for one SKU, in RINGGIT. Changes the price list only — orders already costed keep the figure they were costed at.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        supplier: { type: 'string', description: 'Supplier name, from list_suppliers.' },
        code: { type: 'string', description: 'The SKU code, e.g. RT10.' },
        costRm: { type: 'number', description: 'Per-unit cost in ringgit. Pass null to remove this supplier\'s price for the SKU.' },
      },
      required: ['supplier', 'code'],
    },
    run: async ({ fastify, prisma }, input) => {
      const supplier = await resolveSupplier(fastify, input.supplier);
      const variant = await resolveVariantByCode(prisma, input.code);
      const cost = input.costRm == null ? null : toCents(Number(input.costRm));
      if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new Error('costRm must be 0 or more.');
      await setSupplierCosts(fastify, { costs: [{ supplierId: supplier.id, variantId: variant.id, cost }] });
      const name = `${variant.product.name}${variant.size ? ` ${variant.size}` : ''} (${variant.code})`;
      return cost === null
        ? { removed: `${supplier.name} no longer lists ${name}` }
        : { set: `${supplier.name} · ${name} at ${rm(cost)} per unit` };
    },
  },
];
