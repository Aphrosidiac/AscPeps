import { randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { getVariantDisplayName } from './product-addons.js';
import type { ResolvedLine } from './order-lines.js';

/**
 * Group Buy — the rules every door shares (public batch page, checkout, admin,
 * member dashboard, emails). A batch sells its own list of sizes at wholesale
 * tiers picked by the CUSTOMER'S OWN quantity of that item, within a window.
 * Prices are per sell unit (a vial, or a kit of packSize vials); order lines
 * are stored per vial so costing and supplier prices work unchanged.
 * See docs/group-buy.md.
 */

export interface GroupBuyStage {
  key: string;
  label: string;
  /** What this step means, in a sentence. */
  detail?: string | null;
  /** Free text the customer reads before the step is reached ("Week of 8 Dec"). */
  eta?: string | null;
  /** ISO time the batch reached this step; stamped when the stage moves on. */
  doneAt?: string | null;
  /** A note for buyers on this step ("Tracking numbers go out tonight"). */
  note?: string | null;
}

// A starting point only: every label, detail and step is editable per batch.
// Worded as what happens, never as a promise of a date or a test result.
export const DEFAULT_STAGES: GroupBuyStage[] = [
  { key: 'open', label: 'Batch open', detail: 'Orders are being taken at batch prices.' },
  { key: 'closed', label: 'Batch closed', detail: 'Orders are in. We total the batch and place it with our supplier.' },
  { key: 'ordered', label: 'Ordered from supplier', detail: 'The batch order is placed and paid.' },
  { key: 'transit', label: 'On the way to us', detail: 'The batch has left the supplier.' },
  { key: 'arrived', label: 'Arrived at Ascend', detail: 'Stock is in and being checked against the batch.' },
  { key: 'packing', label: 'Packing orders', detail: 'Your order is being packed.' },
  { key: 'shipped', label: 'Shipped', detail: 'On its way to you. Tracking is on your order.' },
  { key: 'delivered', label: 'Delivered', detail: 'Delivered. Thank you for joining the batch.' },
];

export function parseStages(raw: unknown): GroupBuyStage[] {
  if (!Array.isArray(raw)) return DEFAULT_STAGES.map((s) => ({ ...s }));
  const out: GroupBuyStage[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.key !== 'string' || typeof o.label !== 'string') continue;
    out.push({
      key: o.key,
      label: o.label,
      detail: typeof o.detail === 'string' ? o.detail : null,
      eta: typeof o.eta === 'string' ? o.eta : null,
      doneAt: typeof o.doneAt === 'string' ? o.doneAt : null,
      note: typeof o.note === 'string' ? o.note : null,
    });
  }
  return out.length ? out : DEFAULT_STAGES.map((s) => ({ ...s }));
}

/** Where the batch is in time: DRAFT (unpublished), UPCOMING, LIVE, CLOSED. */
export type GroupBuyPhase = 'DRAFT' | 'UPCOMING' | 'LIVE' | 'CLOSED';

export function groupBuyPhase(gb: { published: boolean; opensAt: Date; closesAt: Date }, now = new Date()): GroupBuyPhase {
  if (!gb.published) return 'DRAFT';
  if (now < gb.opensAt) return 'UPCOMING';
  if (now >= gb.closesAt) return 'CLOSED';
  return 'LIVE';
}

/** "Batch 03" */
export function batchLabel(number: number): string {
  return `Batch ${String(number).padStart(2, '0')}`;
}

export interface TierLike { minQty: number; price: number }

/** Tiers low to high by quantity. */
export function sortTiers<T extends TierLike>(tiers: T[]): T[] {
  return [...tiers].sort((a, b) => a.minQty - b.minQty);
}

/** The tier a quantity of sell units falls in, or null below the first tier. */
export function tierFor<T extends TierLike>(tiers: T[], qty: number): T | null {
  let hit: T | null = null;
  for (const t of sortTiers(tiers)) if (qty >= t.minQty) hit = t;
  return hit;
}

export interface ItemRules {
  sellUnit: string;
  packSize: number;
  minQty: number | null;
  maxQty: number | null;
  minAmount: number | null;
  unitLabel?: string | null;
}

/** The least a customer may order of this item: its own minimum, and never below the first tier. */
export function itemMinQty(item: ItemRules & { tiers: TierLike[] }): number {
  const first = sortTiers(item.tiers)[0]?.minQty ?? 1;
  return Math.max(item.minQty ?? 1, first, 1);
}

export function vialsPerUnit(item: { sellUnit: string; packSize: number }): number {
  return item.sellUnit === 'KIT' ? Math.max(item.packSize, 1) : 1;
}

/** "kit" / "kits" / "vial" / "vials", or the item's own label. */
export function unitWord(item: { sellUnit: string; unitLabel?: string | null }, qty = 1): string {
  if (item.unitLabel?.trim()) return item.unitLabel.trim();
  const base = item.sellUnit === 'KIT' ? 'kit' : 'vial';
  return qty === 1 ? base : `${base}s`;
}

/** "3 kits · 30 vials" or "12 vials". */
export function describeQty(item: { sellUnit: string; packSize: number; unitLabel?: string | null }, qty: number): string {
  if (item.sellUnit !== 'KIT') return `${qty} ${unitWord(item, qty)}`;
  return `${qty} ${unitWord(item, qty)} · ${qty * vialsPerUnit(item)} vials`;
}

/**
 * Why a quantity is not allowed for an item, in the customer's words, or null
 * when it is. `price` is the tier price per sell unit.
 */
export function itemQtyProblem(item: ItemRules & { tiers: TierLike[] }, qty: number, name: string): string | null {
  const min = itemMinQty(item);
  if (qty < min) return `${name}: the minimum is ${min} ${unitWord(item, min)}.`;
  if (item.maxQty != null && qty > item.maxQty) return `${name}: the most one order can take is ${item.maxQty} ${unitWord(item, item.maxQty)}.`;
  const tier = tierFor(item.tiers, qty);
  if (!tier) return `${name} has no price for ${qty} ${unitWord(item, qty)}.`;
  if (item.minAmount != null && tier.price * qty < item.minAmount) {
    return `${name}: the minimum for this item is RM${(item.minAmount / 100).toFixed(2)}.`;
  }
  return null;
}

/**
 * A kit's price has to split evenly into its vials, because order lines are
 * stored per vial. Returns the problem, or null.
 */
export function kitPriceProblem(sellUnit: string, packSize: number, price: number): string | null {
  if (sellUnit !== 'KIT' || packSize <= 1) return null;
  if (price % packSize === 0) return null;
  const down = price - (price % packSize);
  const up = down + packSize;
  return `RM${(price / 100).toFixed(2)} does not split evenly into ${packSize} vials — use RM${(down / 100).toFixed(2)} or RM${(up / 100).toFixed(2)}.`;
}

export interface JoinedSettings { joinedMode: string; joinedBoost: number; joinedFixed: number }

/** The number shown to customers, or null when the counter is off. */
export function joinedCount(gb: JoinedSettings, real: number): number | null {
  switch (gb.joinedMode) {
    case 'REAL': return real;
    case 'BOOST': return real + Math.max(gb.joinedBoost, 0);
    case 'FIXED': return Math.max(gb.joinedFixed, 0);
    default: return null;
  }
}

/** Is a scheduled promo piece (banner, popup) showing right now? */
export function inWindow(startsAt: Date | null, endsAt: Date | null, now = new Date()): boolean {
  if (startsAt && now < startsAt) return false;
  if (endsAt && now >= endsAt) return false;
  return true;
}

/** A sign-up reward code: GB03-K7Q2M. No 0/O/1/I so it can be read out. */
export function newRewardCode(number: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(5);
  let tail = '';
  for (const b of bytes) tail += alphabet[b % alphabet.length];
  return `GB${String(number).padStart(2, '0')}-${tail}`;
}

export class GroupBuyOrderError extends Error {}

export const GROUP_BUY_ORDER_INCLUDE = {
  items: {
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
    include: {
      tiers: { orderBy: { minQty: 'asc' } },
      variant: { include: { product: { select: { id: true, name: true, active: true, slug: true } } } },
    },
  },
} satisfies Prisma.GroupBuyInclude;

export type GroupBuyForOrder = Prisma.GroupBuyGetPayload<{ include: typeof GROUP_BUY_ORDER_INCLUDE }>;

type Db = Pick<PrismaClient, 'groupBuy'>;

/**
 * Turn a Group Buy basket into order lines. `quantity` in the input is SELL
 * UNITS (kits or vials as the batch sells the item); the lines come back per
 * vial with the whole quantity marked preorderQty — none of it comes out of
 * store stock, the batch is bought from the supplier after it closes.
 * Every rule is checked here, server side: window, item list, minimums,
 * maximums and the batch's order-level limits.
 */
export async function resolveGroupBuyLines(
  db: Db,
  groupBuyId: string,
  input: { variantId: string; quantity: number }[],
  now = new Date()
): Promise<{ groupBuy: GroupBuyForOrder; lines: ResolvedLine[] }> {
  const gb = await db.groupBuy.findUnique({ where: { id: groupBuyId }, include: GROUP_BUY_ORDER_INCLUDE });
  if (!gb) throw new GroupBuyOrderError('This Group Buy was not found.');
  const phase = groupBuyPhase(gb, now);
  if (phase === 'UPCOMING') throw new GroupBuyOrderError(`${batchLabel(gb.number)} has not opened yet.`);
  if (phase === 'CLOSED') throw new GroupBuyOrderError(`${batchLabel(gb.number)} has closed.`);
  if (phase === 'DRAFT') throw new GroupBuyOrderError('This Group Buy is not open.');

  // One line per item: a variant sent twice is summed.
  const wanted = new Map<string, number>();
  for (const i of input) wanted.set(i.variantId, (wanted.get(i.variantId) ?? 0) + i.quantity);

  const lines: ResolvedLine[] = [];
  let units = 0;
  for (const [variantId, qty] of wanted) {
    if (qty <= 0) continue;
    const item = gb.items.find((it) => it.variantId === variantId);
    if (!item || !item.variant.active || !item.variant.product.active) {
      throw new GroupBuyOrderError('One of these items is not in this batch any more. Refresh the page and try again.');
    }
    const name = getVariantDisplayName(item.variant.product, item.variant);
    const problem = itemQtyProblem(item, qty, name);
    if (problem) throw new GroupBuyOrderError(problem);
    const tier = tierFor(item.tiers, qty)!;
    const perVial = vialsPerUnit(item);
    const vials = qty * perVial;
    units += qty;
    lines.push({
      variantId,
      quantity: vials,
      preorderQty: vials,
      // Kit prices are validated to divide evenly when the batch is saved;
      // Math.round only guards a batch saved before that check existed.
      unitPrice: Math.round(tier.price / perVial),
      name,
      code: item.variant.code,
      noShipping: false,
      includes: [],
      packSize: item.sellUnit === 'KIT' ? perVial : null,
    });
  }
  if (lines.length === 0) throw new GroupBuyOrderError('Add at least one item to your Group Buy order.');
  if (units > gb.maxUnitsPerOrder) {
    throw new GroupBuyOrderError(`One order can take up to ${gb.maxUnitsPerOrder} units in this batch.`);
  }
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  if (gb.minOrderAmount != null && subtotal < gb.minOrderAmount) {
    throw new GroupBuyOrderError(`The minimum order in this batch is RM${(gb.minOrderAmount / 100).toFixed(2)}.`);
  }
  return { groupBuy: gb, lines };
}
