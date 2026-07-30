/**
 * Lifetime finance maths: what each partner has earned, what the company's own
 * spending has taken off them, what they've put in, and what they're actually
 * owed.
 *
 * Everything derived here is computed on read — nothing is stored. Correcting
 * an old order's costs therefore corrects every downstream balance for free.
 * The flip side is that a historical number can move, which is fine while no
 * payout has been made against it; see docs/finance-section-plan.md.
 *
 * The genuinely recorded events — funding, repayments, payouts — are real rows
 * and are never recomputed.
 *
 * All amounts are integer cents.
 */

import { costOrder, allocate, type CostableOrder } from './profit.js';

/**
 * Splits `amount` across arbitrary weights (not necessarily summing to 10000),
 * largest-remainder, so the parts always sum back to exactly `amount`.
 *
 * `allocate()` in profit.ts assumes basis points out of 10000 because a profit
 * split is validated to total 100%. Ownership is edited independently and can
 * legitimately be mid-edit or drifted, and an expense must still be fully
 * distributed rather than partly vanishing — hence normalising here instead of
 * reusing that assumption.
 */
export function allocateByWeights(amount: number, weights: number[]): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (weights.length === 0 || total <= 0) return weights.map(() => 0);
  // Scale to basis points, then defer to the same largest-remainder routine so
  // both allocations round identically.
  const bps = weights.map((w) => (w / total) * 10_000);
  return allocate(amount, bps);
}

export type FundingType = 'CONTRIBUTION' | 'ADVANCE';
export type ExpenseAllocationMode = 'OWNERSHIP' | 'SINGLE_PARTNER' | 'UNALLOCATED';

export interface FinancePartner {
  id: string;
  name: string;
  active: boolean;
  ownershipBps: number;
}

export interface FinanceOrder extends CostableOrder {
  id: string;
  profitShares: { partnerId: string | null; shareBps: number }[];
}

export interface FinanceExpense {
  id: string;
  amount: number;
  allocation: ExpenseAllocationMode;
  chargedToPartnerId: string | null;
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
}

export interface PartnerBalance {
  partnerId: string;
  name: string;
  active: boolean;
  ownershipBps: number;
  /** Their cut of profit from every fully-costed, paid order. */
  earned: number;
  /** Their share of company spending. Positive = charged to them. */
  expenseShare: number;
  /** Capital they never want back. Never counted in `owed`. */
  contributed: number;
  advancesTotal: number;
  advancesRepaid: number;
  /** Money the company still has to return to them. */
  advancesOutstanding: number;
  /** Earned profit already handed over. */
  paidOut: number;
  /** earned − expenseShare + advancesOutstanding − paidOut */
  owed: number;
}

export interface FinanceSummary {
  /** Sum of profit across fully-costed paid orders. Before company spending. */
  grossOrderProfit: number;
  companySpend: number;
  /** grossOrderProfit − companySpend. The number that's actually real. */
  netProfit: number;
  /** Spending the company absorbed rather than charging to anyone. */
  unallocatedSpend: number;
  totalContributed: number;
  totalAdvancesOutstanding: number;
  totalPaidOut: number;
  costedOrders: number;
  /** Paid orders still missing a cost — their profit is in none of the above. */
  uncostedOrders: number;
  partners: PartnerBalance[];
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
    ownershipBps: p.ownershipBps,
    earned: 0,
    expenseShare: 0,
    contributed: 0,
    advancesTotal: 0,
    advancesRepaid: 0,
    advancesOutstanding: 0,
    paidOut: 0,
    owed: 0,
  });

  const byId = new Map<string, PartnerBalance>(partners.map((p) => [p.id, blank(p)]));

  /* ----- earned: allocate each costed order's profit across its own split */
  let grossOrderProfit = 0;
  let costedOrders = 0;
  let uncostedOrders = 0;

  for (const order of orders) {
    const { profit } = costOrder(order);
    if (profit === null) {
      uncostedOrders++;
      continue;
    }
    costedOrders++;
    grossOrderProfit += profit;

    // Only shares pointing at a known partner can be attributed. A share whose
    // partner was deleted lands nowhere rather than being silently reassigned.
    const shares = order.profitShares.filter((s) => s.partnerId && byId.has(s.partnerId));
    if (shares.length === 0) continue;

    const amounts = allocate(profit, shares.map((s) => s.shareBps));
    shares.forEach((share, i) => {
      byId.get(share.partnerId as string)!.earned += amounts[i];
    });
  }

  /* ----- company spending */
  let companySpend = 0;
  let unallocatedSpend = 0;

  // Ownership allocation covers ACTIVE partners only — a departed partner
  // shouldn't be charged for spending that happened after they left.
  const owners = partners.filter((p) => p.active && p.ownershipBps > 0);

  for (const expense of expenses) {
    companySpend += expense.amount;

    if (expense.allocation === 'SINGLE_PARTNER') {
      const target = expense.chargedToPartnerId ? byId.get(expense.chargedToPartnerId) : undefined;
      if (target) target.expenseShare += expense.amount;
      // Charged to a partner who no longer exists: treat as absorbed rather
      // than silently spreading it onto everyone else.
      else unallocatedSpend += expense.amount;
      continue;
    }

    if (expense.allocation === 'UNALLOCATED' || owners.length === 0) {
      unallocatedSpend += expense.amount;
      continue;
    }

    const amounts = allocateByWeights(expense.amount, owners.map((p) => p.ownershipBps));
    owners.forEach((owner, i) => {
      byId.get(owner.id)!.expenseShare += amounts[i];
    });
  }

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
  for (const payout of payouts) {
    const balance = byId.get(payout.partnerId);
    if (balance) balance.paidOut += payout.amount;
  }

  const balances = [...byId.values()];
  for (const b of balances) {
    // Contributions are deliberately absent: that is the entire difference
    // between the two funding types.
    b.owed = b.earned - b.expenseShare + b.advancesOutstanding - b.paidOut;
  }

  balances.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return {
    grossOrderProfit,
    companySpend,
    netProfit: grossOrderProfit - companySpend,
    unallocatedSpend,
    totalContributed: balances.reduce((s, b) => s + b.contributed, 0),
    totalAdvancesOutstanding: balances.reduce((s, b) => s + b.advancesOutstanding, 0),
    totalPaidOut: balances.reduce((s, b) => s + b.paidOut, 0),
    costedOrders,
    uncostedOrders,
    partners: balances,
  };
}
