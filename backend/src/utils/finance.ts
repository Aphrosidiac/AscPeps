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
 * All amounts are integer cents.
 */

import { costOrder, allocate, type CostableOrder } from './profit.js';

export type FundingType = 'CONTRIBUTION' | 'ADVANCE';

export interface FinancePartner {
  id: string;
  name: string;
  active: boolean;
}

export interface FinanceOrder extends CostableOrder {
  id: string;
  /**
   * `shareBps` governs profit only. `capitalAmount` is how much of this order's
   * COSTS this person paid for up front — money owed back to them on top of
   * their profit cut, never a deduction.
   */
  profitShares: { partnerId: string | null; shareBps: number; capitalAmount: number }[];
}

export interface FinanceExpense {
  id: string;
  amount: number;
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
  /** Their cut of profit from every fully-costed, paid order. */
  earned: number;
  /** Order costs they paid for out of pocket. Owed back to them. */
  capitalFronted: number;
  /** Capital they never want back. Never counted in `owed`. */
  contributed: number;
  advancesTotal: number;
  advancesRepaid: number;
  /** Money the company still has to return to them. */
  advancesOutstanding: number;
  /** Earned profit already handed over. */
  paidOut: number;
  /** earned + capitalFronted + advancesOutstanding − paidOut */
  owed: number;
}

export interface FinanceSummary {
  /** Sum of profit across fully-costed paid orders. Before company spending. */
  grossOrderProfit: number;
  companySpend: number;
  /** grossOrderProfit − companySpend. The number that's actually real. */
  netProfit: number;
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
    earned: 0,
    capitalFronted: 0,
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
      if (balance) balance.capitalFronted += share.capitalAmount;
    }
  }

  /* ----- company spending: reduces company profit, and nothing else. It never
     lands on a person as a charge — nothing in this file ever does. If someone
     paid for it, that is money owed back to them, recorded either as the
     capital on an order's split or as funding below. */
  const companySpend = expenses.reduce((sum, e) => sum + e.amount, 0);

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
    b.owed = b.earned + b.capitalFronted + b.advancesOutstanding - b.paidOut;
  }

  balances.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return {
    grossOrderProfit,
    companySpend,
    netProfit: grossOrderProfit - companySpend,
    totalContributed: balances.reduce((s, b) => s + b.contributed, 0),
    totalAdvancesOutstanding: balances.reduce((s, b) => s + b.advancesOutstanding, 0),
    totalPaidOut: balances.reduce((s, b) => s + b.paidOut, 0),
    costedOrders,
    uncostedOrders,
    partners: balances,
  };
}
