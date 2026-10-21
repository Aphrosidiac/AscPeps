/**
 * Lifetime finance maths: what each partner has earned, what they have put in
 * — both as capital fronted on individual orders and as standing funding — and
 * what they are actually owed once payouts are taken off.
 *
 * Everything derived here is computed on read — nothing is stored. Correcting
 * an old order's costs therefore corrects every downstream balance for free.
 * The flip side is that a historical number can move, which is fine while no
 * payout has been made against it; see docs/finance-section-plan.md.
 *
 * The genuinely recorded events — funding, repayments, payouts — are real rows
 * and are never recomputed.
 *
 * Three rules the arithmetic here encodes, each of which was previously wrong:
 *
 *  1. Revenue is counted for every order the money arrived on. Only PROFIT
 *     waits for costing. The two used to move together, so an uncosted order
 *     contributed nothing at all and the takings read low.
 *  2. A refund reverses revenue by its exact amount and leaves the costs we
 *     already paid standing. Refunded orders used to be filtered out of the
 *     input entirely, which erased the courier and the goods along with the
 *     sale.
 *  3. Stock bought ahead of demand is not an operating cost. It is charged
 *     once, as COGS, when the goods sell — never both there and as spending.
 *
 * All amounts are integer cents.
 */

import { costOrder, allocate, type CostableOrder } from './profit.js';

export type FundingType = 'CONTRIBUTION' | 'ADVANCE';

export interface FinancePartner {
  id: string;
  name: string;
  active: boolean;
  /**
   * COMPANY is Ascend itself: its share of a split is retained profit that
   * stays in the bank. It is reported apart (`ascend`) and is never "owed".
   * Absent is read as PERSON, so older callers keep their behaviour.
   */
  kind?: 'PERSON' | 'COMPANY';
}

export interface FinanceOrder extends CostableOrder {
  id: string;
  /**
   * `shareBps` governs profit only. `capitalAmount` is how much of this order's
   * COSTS this person paid for up front — money owed back to them on top of
   * their profit cut, never a deduction.
   */
  profitShares: {
    partnerId: string | null;
    shareBps: number;
    capitalAmount: number;
    /** Set once this capital became an ADVANCE at the bank cutover. */
    capitalFundingId?: string | null;
  }[];
  /**
   * The order's profit has been shared out — by a share-out run, or ticked by
   * hand before the bank. A shared order is settled: its profit and its
   * fronted capital are no longer owed to anyone.
   */
  shared?: boolean;
}

export type ExpenseKind = 'OPERATING' | 'INVENTORY';

export interface FinanceExpense {
  id: string;
  amount: number;
  /**
   * Absent is read as OPERATING, matching the column default — a caller that
   * predates the split gets exactly the behaviour it had.
   */
  kind?: ExpenseKind;
}

export interface FinanceFunding {
  id: string;
  partnerId: string;
  type: FundingType;
  amount: number;
  repayments: { amount: number }[];
}

export interface FinancePayout {
  partnerId: string;
  amount: number;
  /**
   * The share-out it was part of. A run's payouts settle the run's orders,
   * which drop out of `toShare` — so only a payout with no run (a payment on
   * account) is taken off what is owed.
   */
  runId?: string | null;
}

export interface PartnerBalance {
  partnerId: string;
  name: string;
  active: boolean;
  kind: 'PERSON' | 'COMPANY';
  /** Their cut of profit from every fully-costed, paid order. */
  earned: number;
  /** The part of `earned` from orders not shared out yet. */
  toShare: number;
  /**
   * Order costs they paid for out of pocket, every order ever — history. The
   * bank pays for orders now; see `capitalOwed` for what is still due.
   */
  capitalFronted: number;
  /**
   * Fronted capital on orders not yet shared out and not yet moved into an
   * advance at the cutover. Zero once the cutover script has run.
   */
  capitalOwed: number;
  /** Capital they never want back. Never counted in `owed`. */
  contributed: number;
  advancesTotal: number;
  advancesRepaid: number;
  /** Money the company still has to return to them. */
  advancesOutstanding: number;
  /** Every payout recorded to them — share-outs and payments on account. */
  paidOut: number;
  /** toShare + capitalOwed + advancesOutstanding − payouts on account */
  owed: number;
}

/** Ascend's own position. Its share is never paid out — it stays in the bank. */
export interface AscendBalance {
  partnerId: string;
  name: string;
  /** Ascend's share of every costed order's profit. */
  retained: number;
  /** The part of `retained` on orders not shared out yet. */
  toKeep: number;
}

export interface FinanceSummary {
  /**
   * Net revenue across EVERY order the money arrived on, costed or not, less
   * anything refunded. Counting this only for costed orders is what used to
   * make a month's takings look smaller than they were, purely because nobody
   * had typed the unit costs in yet.
   */
  revenue: number;
  /** Cents handed back to customers, already deducted from `revenue`. */
  refunded: number;
  /** The part of `revenue` whose costs are known. */
  costedRevenue: number;
  /** The rest of it — real money in, profit unknowable until it is costed. */
  uncostedRevenue: number;

  /* The cost side, all measured over the SAME costed orders as costedRevenue,
     so grossOrderProfit === costedRevenue − cogs − extraCosts − gatewayFees
     exactly. Mixing in figures from uncosted orders would break that identity
     and leave a summary that doesn't add up. */
  cogs: number;
  extraCosts: number;
  gatewayFees: number;

  /** costedRevenue − cogs − extraCosts − gatewayFees. Before company spending. */
  grossOrderProfit: number;

  /** Spending consumed now. The only expense figure that reduces net profit. */
  operatingSpend: number;
  /** Spending that bought stock. Becomes a cost as COGS when the goods sell. */
  inventoryPurchased: number;
  /** Every expense row added up — cash out, regardless of kind. */
  companySpend: number;
  /**
   * inventoryPurchased − cogs. Negative is meaningful, not an error: it means
   * more stock has been sold than this system has ever recorded buying,
   * because the purchases predate it.
   */
  stockOnHand: number;

  /** grossOrderProfit − operatingSpend. The number that's actually real. */
  netProfit: number;

  totalContributed: number;
  totalAdvancesOutstanding: number;
  totalPaidOut: number;
  costedOrders: number;
  /** Paid orders still missing a cost — their PROFIT is in none of the above. */
  uncostedOrders: number;
  /** People only. Ascend is `ascend`. */
  partners: PartnerBalance[];
  /** Null on a database with no COMPANY partner (before the bank migration). */
  ascend: AscendBalance | null;
}

export function computeFinance(input: {
  partners: FinancePartner[];
  orders: FinanceOrder[];
  expenses: FinanceExpense[];
  funding: FinanceFunding[];
  payouts: FinancePayout[];
}): FinanceSummary {
  const { partners, orders, expenses, funding, payouts } = input;

  const blank = (p: FinancePartner): PartnerBalance => ({
    partnerId: p.id,
    name: p.name,
    active: p.active,
    kind: p.kind ?? 'PERSON',
    earned: 0,
    toShare: 0,
    capitalFronted: 0,
    capitalOwed: 0,
    contributed: 0,
    advancesTotal: 0,
    advancesRepaid: 0,
    advancesOutstanding: 0,
    paidOut: 0,
    owed: 0,
  });

  const byId = new Map<string, PartnerBalance>(partners.map((p) => [p.id, blank(p)]));

  /* ----- revenue and earned.
     Revenue is counted for EVERY order in `orders` — profit is not. That split
     is the point: the money arriving is a fact, while what it earned is
     unknowable until someone prices the lines. Reporting both off the costed
     subset used to make revenue itself look smaller than it was. */
  let revenue = 0;
  let refunded = 0;
  let costedRevenue = 0;
  let cogs = 0;
  let extraCosts = 0;
  let gatewayFees = 0;
  let costedOrders = 0;
  let uncostedOrders = 0;

  for (const order of orders) {
    const costing = costOrder(order);

    revenue += costing.revenue;
    refunded += costing.refunded;

    if (costing.profit === null) {
      uncostedOrders++;
      continue;
    }
    costedOrders++;
    costedRevenue += costing.revenue;
    cogs += costing.itemCost;
    extraCosts += costing.extraCost;
    gatewayFees += costing.gatewayFee;

    const profit = costing.profit;

    // Only shares pointing at a known partner can be attributed. A share whose
    // partner was deleted lands nowhere rather than being silently reassigned.
    const shares = order.profitShares.filter((s) => s.partnerId && byId.has(s.partnerId));
    if (shares.length === 0) continue;

    const amounts = allocate(profit, shares.map((s) => s.shareBps));
    shares.forEach((share, i) => {
      const balance = byId.get(share.partnerId as string)!;
      balance.earned += amounts[i];
      if (!order.shared) balance.toShare += amounts[i];
    });
  }

  /* ----- capital fronted: what each person paid out of pocket to cover an
     order's costs. The company owes it straight back, so it is added to their
     balance, not deducted — the money left their hands, it was never their
     share of anything.

     Counted from every paid order that has a split, whether or not the order is
     costed. Unlike profit this isn't derived from anything, it was typed in
     because it actually happened, and withholding it until costing is done
     would understate what someone is owed for work already finished. */
  for (const order of orders) {
    for (const share of order.profitShares) {
      if (!share.partnerId || share.capitalAmount === 0) continue;
      const balance = byId.get(share.partnerId);
      if (!balance) continue;
      balance.capitalFronted += share.capitalAmount;
      // A shared order was settled in full, capital included — that is what
      // ticking "Profit Shared" meant before the bank. Capital that became an
      // advance at the cutover is owed through that advance instead; counting
      // it here as well would pay it back twice.
      if (!order.shared && !share.capitalFundingId) balance.capitalOwed += share.capitalAmount;
    }
  }

  /* ----- company spending: reduces company profit, and nothing else. It never
     lands on a person as a charge — nothing in this file ever does. If someone
     paid for it, that is money owed back to them, recorded either as the
     capital on an order's split or as funding below.

     Split by kind, because only OPERATING spending is a cost now. INVENTORY
     spending bought goods we still hold; charging it here AND again as COGS
     when those goods sell is the double-count this separation removes. */
  let operatingSpend = 0;
  let inventoryPurchased = 0;
  for (const expense of expenses) {
    if (expense.kind === 'INVENTORY') inventoryPurchased += expense.amount;
    else operatingSpend += expense.amount;
  }
  const companySpend = operatingSpend + inventoryPurchased;

  /* ----- money in */
  for (const entry of funding) {
    const balance = byId.get(entry.partnerId);
    if (!balance) continue;

    if (entry.type === 'CONTRIBUTION') {
      balance.contributed += entry.amount;
      continue;
    }

    const repaid = entry.repayments.reduce((sum, r) => sum + r.amount, 0);
    balance.advancesTotal += entry.amount;
    balance.advancesRepaid += repaid;
    // Clamped: over-repaying an advance is a data-entry error, not a debt the
    // partner owes the company back.
    balance.advancesOutstanding += Math.max(0, entry.amount - repaid);
  }

  /* ----- money out */
  const onAccount = new Map<string, number>();
  for (const payout of payouts) {
    const balance = byId.get(payout.partnerId);
    if (!balance) continue;
    balance.paidOut += payout.amount;
    if (!payout.runId) onAccount.set(payout.partnerId, (onAccount.get(payout.partnerId) ?? 0) + payout.amount);
  }

  // Owed is built from what is still OPEN, not from lifetime earnings less
  // lifetime payouts. Before the bank, profit was settled by ticking "Profit
  // Shared" with the money moving outside the system and almost never a payout
  // recorded, so earned − paidOut read as months of profit still owed. A shared
  // order is settled; what is owed is the unshared orders, the capital still
  // due, open advances, less anything paid on account.
  //
  // Contributions are deliberately absent: that is the entire difference
  // between the two funding types.
  const all = [...byId.values()];
  for (const b of all) {
    b.owed = b.toShare + b.capitalOwed + b.advancesOutstanding - (onAccount.get(b.partnerId) ?? 0);
  }

  const company = all.find((b) => b.kind === 'COMPANY') ?? null;
  const balances = all.filter((b) => b.kind !== 'COMPANY');
  balances.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  // Derived from its own components rather than accumulated separately, so the
  // summary can never report a gross profit that its own cost lines disagree
  // with.
  const grossOrderProfit = costedRevenue - cogs - extraCosts - gatewayFees;

  return {
    revenue,
    refunded,
    costedRevenue,
    uncostedRevenue: revenue - costedRevenue,
    cogs,
    extraCosts,
    gatewayFees,
    grossOrderProfit,
    operatingSpend,
    inventoryPurchased,
    companySpend,
    stockOnHand: inventoryPurchased - cogs,
    netProfit: grossOrderProfit - operatingSpend,
    totalContributed: balances.reduce((s, b) => s + b.contributed, 0),
    totalAdvancesOutstanding: balances.reduce((s, b) => s + b.advancesOutstanding, 0),
    totalPaidOut: balances.reduce((s, b) => s + b.paidOut, 0),
    costedOrders,
    uncostedOrders,
    partners: balances,
    ascend: company
      ? { partnerId: company.partnerId, name: company.name, retained: company.earned, toKeep: company.toShare }
      : null,
  };
}
