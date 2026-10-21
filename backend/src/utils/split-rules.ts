/**
 * The default profit split, and putting it on orders.
 *
 * A split is stored per order (order_profit_shares) because what an order
 * agreed to must not move when the rule changes. The rule only decides what a
 * paid order with NO split gets: the version in effect when it was paid,
 * copied onto the order once. Before 2026-10-21 that default lived in the
 * order page's code (Fakhrul 30 / Asyraf 70), so storefront and assistant
 * orders arrived with no split until someone clicked "Add people".
 *
 * Applied in two places, deliberately both:
 *  - at the PAID transition (applyPaid, adminUpdateOrder), so a split exists
 *    the moment there is profit to divide;
 *  - as a sweep before every money read (ensureDefaultSplits with no ids), so
 *    a paid order that reached PAID by any path nobody hooked still gets one
 *    before anything sums it.
 */
import type { PrismaClient } from '@prisma/client';

type Db = Pick<PrismaClient, 'profitSplitRule' | 'order' | 'orderProfitShare'>;

export interface SplitRuleShare {
  partnerId: string;
  name: string;
  kind: 'PERSON' | 'COMPANY';
  shareBps: number;
}

export interface SplitRule {
  id: string;
  effectiveFrom: Date;
  note: string | null;
  createdBy: string | null;
  createdAt: Date;
  shares: SplitRuleShare[];
}

/** People first (largest share first), Ascend last — how the split is read out. */
export function sortShares<T extends { kind: string; shareBps: number; name: string }>(shares: T[]): T[] {
  return [...shares].sort(
    (a, b) =>
      Number(a.kind === 'COMPANY') - Number(b.kind === 'COMPANY') ||
      b.shareBps - a.shareBps ||
      a.name.localeCompare(b.name)
  );
}

/** Every version, newest first. */
export async function loadSplitRules(db: Pick<PrismaClient, 'profitSplitRule'>): Promise<SplitRule[]> {
  const rules = await db.profitSplitRule.findMany({
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    include: { shares: { include: { partner: { select: { id: true, name: true, kind: true } } } } },
  });
  return rules.map((r) => ({
    id: r.id,
    effectiveFrom: r.effectiveFrom,
    note: r.note,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    shares: sortShares(
      r.shares.map((s) => ({ partnerId: s.partnerId, name: s.partner.name, kind: s.partner.kind, shareBps: s.shareBps }))
    ),
  }));
}

/** The rule in effect at `at`. Rules are newest first; null before the first. */
export function ruleAt(rules: SplitRule[], at: Date): SplitRule | null {
  return rules.find((r) => r.effectiveFrom.getTime() <= at.getTime()) ?? null;
}

/**
 * Give every paid order that has no split the rule in effect when it was
 * paid. With `orderIds`, only those orders. Returns how many got one.
 *
 * Paid = PAID or REFUNDED, the same set the finance maths reads. `paidAt` is
 * stamped by the database trigger; an order without one (pre-trigger rows)
 * falls back to when it was placed.
 */
export async function ensureDefaultSplits(db: Db, orderIds?: string[]): Promise<number> {
  const orders = await db.order.findMany({
    where: {
      ...(orderIds ? { id: { in: orderIds } } : {}),
      deletedAt: null,
      paymentStatus: { in: ['PAID', 'REFUNDED'] },
      profitShares: { none: {} },
    },
    select: { id: true, paidAt: true, createdAt: true },
  });
  if (orders.length === 0) return 0;

  const rules = await loadSplitRules(db);
  let applied = 0;
  for (const order of orders) {
    const rule = ruleAt(rules, order.paidAt ?? order.createdAt);
    if (!rule || rule.shares.length === 0) continue;
    // createMany inside a guard rather than a bare insert: two sweeps racing
    // on the same order must not give it the split twice. The count check is
    // the guard — whoever gets there second sees shares already present.
    const existing = await db.orderProfitShare.count({ where: { orderId: order.id } });
    if (existing > 0) continue;
    await db.orderProfitShare.createMany({
      data: rule.shares.map((s) => ({ orderId: order.id, partnerId: s.partnerId, name: s.name, shareBps: s.shareBps })),
    });
    applied++;
  }
  return applied;
}
