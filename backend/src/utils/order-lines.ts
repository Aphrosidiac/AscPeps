import type { PrismaClient } from '@prisma/client';
import { getEffectivePrice } from './product-pricing.js';
import { getVariantDisplayName } from './product-addons.js';

/**
 * Two kinds of add-on, told apart by the add-on's own product:
 *
 * - INCLUDED — its product is `addOnOnly` (syringes, swabs, Bac Water, vial
 *   sizes). It belongs to the line it came with: stored as a child OrderItem
 *   (parentItemId), quantity = the add-on's per-unit quantity × the parent
 *   line's quantity, and shown under that line, never as a line of its own.
 *   Required ones always come; optional ones come when the customer ticked
 *   them (`addOnIds`). A priced one (a 10mL vial) adds its price to the order
 *   like any line, it is just listed under the product it belongs to.
 * - SUGGESTED — any other product (MOTS-C offered on Retatrutide). The
 *   storefront adds it as its own ordinary line; nothing here bundles it.
 */

export interface OrderLineInput {
  variantId: string;
  quantity: number;
  /** Optional INCLUDED add-ons the customer ticked for this line. Required ones need not be listed. */
  addOnIds?: string[];
}

export interface ResolvedInclude {
  variantId: string;
  quantity: number;
  unitPrice: number;
  name: string;
  code: string;
}

export interface ResolvedLine {
  variantId: string;
  quantity: number;
  unitPrice: number;
  name: string;
  code: string;
  noShipping: boolean;
  includes: ResolvedInclude[];
}

type Db = Pick<PrismaClient, 'productVariant' | 'productAddOn'>;

export class OrderLineError extends Error {
  constructor(message: string) {
    super(message);
  }
}

/**
 * Turn what the customer asked for into the order's real lines: their chosen
 * products, each with the included add-ons it brings. The server decides the
 * includes from the product's add-on settings — the client only says which
 * OPTIONAL included add-ons were ticked.
 *
 * Carts saved before bundles existed send supplies as lines of their own; a
 * line whose product is addOnOnly and that another line in the order has
 * configured as an add-on is folded into that line instead of standing alone.
 *
 * Throws OrderLineError for an inactive product or not enough stock. A FREE
 * included add-on that is short ships what is left (logged via `warn`) rather
 * than blocking the product it comes with; a priced one is held to its stock.
 */
export async function resolveOrderLines(
  db: Db,
  input: OrderLineInput[],
  opts: { now?: Date; warn?: (msg: string, data: Record<string, unknown>) => void } = {}
): Promise<ResolvedLine[]> {
  const now = opts.now ?? new Date();
  const ids = [...new Set(input.map((i) => i.variantId))];
  const loadVariants = (vids: string[]) => db.productVariant.findMany({
    where: { id: { in: vids } },
    include: { product: { select: { id: true, name: true, active: true, addOnOnly: true, noShipping: true } } },
  });
  const requested = await loadVariants(ids);
  const byId = new Map(requested.map((v) => [v.id, v]));
  for (const id of ids) {
    const v = byId.get(id);
    if (!v || !v.active || !v.product.active) throw new OrderLineError('One or more products not found or inactive');
  }

  const parentProductIds = [...new Set(requested.map((v) => v.product.id))];
  const relations = await db.productAddOn.findMany({
    // Only add-ons that are themselves still sellable: a discontinued supply
    // drops out quietly instead of blocking every product that lists it.
    where: { productId: { in: parentProductIds }, addOn: { active: true, product: { active: true } } },
    include: { addOn: { include: { product: { select: { name: true, addOnOnly: true } } } } },
  });
  const relsByProduct = new Map<string, typeof relations>();
  for (const rel of relations) {
    relsByProduct.set(rel.productId, [...(relsByProduct.get(rel.productId) ?? []), rel]);
  }
  const includedFor = (productId: string) => (relsByProduct.get(productId) ?? []).filter((r) => r.addOn.product.addOnOnly);

  // Fold legacy flat supply lines into the line that lists them.
  const lines = input.map((i) => ({ ...i, addOnIds: [...(i.addOnIds ?? [])] }));
  const kept: typeof lines = [];
  for (const line of lines) {
    const v = byId.get(line.variantId)!;
    if (v.product.addOnOnly) {
      const owner = lines.find((other) => other !== line && !byId.get(other.variantId)!.product.addOnOnly
        && includedFor(byId.get(other.variantId)!.product.id).some((r) => r.addOnId === line.variantId));
      if (owner) {
        if (!owner.addOnIds.includes(line.variantId)) owner.addOnIds.push(line.variantId);
        continue;
      }
    }
    kept.push(line);
  }

  // The same product with the same included choices is one line.
  const merged: typeof kept = [];
  for (const line of kept) {
    const key = (l: typeof line) => `${l.variantId}|${[...l.addOnIds].sort().join(',')}`;
    const same = merged.find((m) => key(m) === key(line));
    if (same) same.quantity += line.quantity;
    else merged.push(line);
  }

  // Required SUGGESTED add-ons (a non-addOnOnly product marked required) keep
  // their old behaviour: added as a line of their own at the configured
  // quantity, unless the order already has at least that many.
  const requiredSuggested = merged.flatMap((line) =>
    (relsByProduct.get(byId.get(line.variantId)!.product.id) ?? []).filter((r) => r.required && !r.addOn.product.addOnOnly)
  );
  for (const v of await loadVariants(requiredSuggested.map((r) => r.addOnId).filter((id) => !byId.has(id)))) byId.set(v.id, v);
  for (const rel of requiredSuggested) {
    const existing = merged.find((m) => m.variantId === rel.addOnId);
    if (existing) existing.quantity = Math.max(existing.quantity, rel.quantity);
    else merged.push({ variantId: rel.addOnId, quantity: rel.quantity, addOnIds: [] });
  }

  const resolved: ResolvedLine[] = merged.map((line) => {
    const v = byId.get(line.variantId)!;
    const includes = includedFor(v.product.id)
      .filter((r) => r.required || line.addOnIds.includes(r.addOnId))
      .map((r) => ({
        variantId: r.addOnId,
        quantity: r.quantity * line.quantity,
        unitPrice: getEffectivePrice(r.addOn, now),
        name: getVariantDisplayName(r.addOn.product, r.addOn),
        code: r.addOn.code,
      }));
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      unitPrice: getEffectivePrice(v, now),
      name: getVariantDisplayName(v.product, v),
      code: v.code,
      noShipping: v.product.noShipping,
      includes,
    };
  });

  // Stock, counted per variant across every line and include. A product the
  // customer chose, or a priced include, must be fully in stock. A free
  // include that is short is cut back to what is left, earliest lines first.
  const stockIds = [...new Set(resolved.flatMap((l) => [l.variantId, ...l.includes.map((i) => i.variantId)]))];
  const stockRows = await db.productVariant.findMany({ where: { id: { in: stockIds } }, select: { id: true, stock: true } });
  const left = new Map(stockRows.map((r) => [r.id, r.stock]));
  for (const line of resolved) {
    const have = left.get(line.variantId) ?? 0;
    if (have < line.quantity) throw new OrderLineError(`Insufficient stock for ${line.name}`);
    left.set(line.variantId, have - line.quantity);
  }
  for (const line of resolved) {
    for (const inc of line.includes) {
      if (inc.unitPrice === 0) continue;
      const have = left.get(inc.variantId) ?? 0;
      if (have < inc.quantity) throw new OrderLineError(`Insufficient stock for ${inc.name}`);
      left.set(inc.variantId, have - inc.quantity);
    }
  }
  for (const line of resolved) {
    for (const inc of line.includes) {
      if (inc.unitPrice !== 0) continue;
      const have = Math.max(left.get(inc.variantId) ?? 0, 0);
      if (have < inc.quantity) {
        opts.warn?.('Included free supply short — order ships without the missing units', { code: inc.code, wanted: inc.quantity, inStock: have });
        inc.quantity = have;
      }
      left.set(inc.variantId, have - inc.quantity);
    }
    line.includes = line.includes.filter((i) => i.quantity > 0);
  }

  return resolved;
}

export function linesSubtotal(lines: ResolvedLine[]): number {
  return lines.reduce(
    (sum, l) => sum + l.unitPrice * l.quantity + l.includes.reduce((s, i) => s + i.unitPrice * i.quantity, 0),
    0
  );
}

/** Units of each variant the lines take out of stock. */
export function stockDemand(lines: ResolvedLine[]): Map<string, number> {
  const demand = new Map<string, number>();
  const add = (id: string, q: number) => demand.set(id, (demand.get(id) ?? 0) + q);
  for (const l of lines) {
    add(l.variantId, l.quantity);
    for (const i of l.includes) add(i.variantId, i.quantity);
  }
  return demand;
}

// ---------------------------------------------------------------------------
// Display grouping

interface GroupableItem {
  id?: string;
  parentItemId?: string | null;
  unitPrice: number;
  variant?: { product?: { addOnOnly?: boolean } | null } | null;
}

export interface GroupedLine<T> {
  item: T;
  includes: T[];
}

/**
 * Order items as the customer thinks of them: each chosen product with what
 * came included under it. Orders from before bundles (no parentItemId) carried
 * their supplies as separate RM0 lines; those — addOnOnly and free — are
 * returned as `looseIncludes` so they can still be shown as included rather
 * than as purchases. Needs `variant.product.addOnOnly` loaded for that.
 */
export function groupOrderItems<T extends GroupableItem>(items: T[]): { lines: GroupedLine<T>[]; looseIncludes: T[] } {
  const children = new Map<string, T[]>();
  for (const item of items) {
    if (item.parentItemId) children.set(item.parentItemId, [...(children.get(item.parentItemId) ?? []), item]);
  }
  const lines: GroupedLine<T>[] = [];
  const looseIncludes: T[] = [];
  for (const item of items) {
    if (item.parentItemId) continue;
    if (item.unitPrice === 0 && item.variant?.product?.addOnOnly) {
      looseIncludes.push(item);
      continue;
    }
    lines.push({ item, includes: (item.id && children.get(item.id)) || [] });
  }
  return { lines, looseIncludes };
}

/** True for an item that came included with another line rather than being chosen. */
export function isIncludedItem(item: GroupableItem): boolean {
  return !!item.parentItemId || (item.unitPrice === 0 && !!item.variant?.product?.addOnOnly);
}

interface NamedItem extends GroupableItem {
  quantity: number;
  variant: { size: string | null; product: { name: string; addOnOnly?: boolean } };
}

const rmText = (sen: number) => `RM${(sen / 100).toFixed(2)}`;

export function itemName(item: NamedItem): string {
  return getVariantDisplayName(item.variant.product, item.variant);
}

/** "1× Bac Water 3mL, 6× Alcohol Swab" — a priced include carries its price. */
export function includesText(includes: NamedItem[], times = '×'): string {
  return includes
    .map((i) => `${i.quantity}${times} ${itemName(i)}${i.unitPrice > 0 ? ` (${rmText(i.unitPrice * i.quantity)})` : ''}`)
    .join(', ');
}

/** What a grouped line costs: the product plus any priced includes. */
export function groupedLineTotal(line: GroupedLine<NamedItem>): number {
  return line.item.unitPrice * line.item.quantity + line.includes.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
}
