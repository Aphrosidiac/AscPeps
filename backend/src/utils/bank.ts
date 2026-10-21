/**
 * Ascend's bank: what moved in and out of the account, and the balance.
 *
 * Derived on read, like every other money figure here. Nearly every movement
 * is already a row somewhere else, and copying those into a ledger table would
 * give two records of one event that can disagree:
 *
 *   IN   the opening balance and other money in   (bank_entries)
 *        a customer payment, net of the gateway   (orders paid since the start)
 *        a partner putting money in               (partner_funding through the bank)
 *   OUT  other money out                          (bank_entries)
 *        money back to a customer                 (orders' refundedAmount)
 *        an expense the company paid              (company_expenses, no partner)
 *        a profit share paid to someone           (profit_payouts)
 *        an advance paid back                     (partner_repayments)
 *
 * The OPENING entry's date is the day tracking started (Fakhrul, 2026-10-21:
 * "all goes into bank starting now"). Nothing dated before it touches the
 * bank, so the years of history before the account existed stay out of it
 * without anyone having to mark them.
 *
 * Crypto (BTCPay) is not here: it settles to a wallet, not the bank. It comes
 * in as an ordinary MONEY_IN when someone cashes it in.
 *
 * All amounts are integer cents.
 */
import type { FastifyInstance } from 'fastify';

export type BankSource =
  | 'OPENING'
  | 'MONEY_IN'
  | 'MONEY_OUT'
  | 'SALE'
  | 'REFUND'
  | 'CAPITAL'
  | 'EXPENSE'
  | 'PAYOUT'
  | 'REPAYMENT';

export interface BankMovement {
  /** `${source}:${row id}` — unique across sources. */
  key: string;
  source: BankSource;
  occurredAt: Date;
  /** Signed: positive in, negative out. */
  amount: number;
  description: string;
  /** Who, when a person is involved (capital, payout, repayment, expense). */
  partnerName: string | null;
  /** Where the movement is recorded, so the page can link to it. */
  ref: { type: 'bank_entry' | 'order' | 'funding' | 'expense' | 'payout_run' | 'payout' | 'repayment'; id: string; label?: string };
  /** Running balance after this movement, oldest first. */
  balance: number;
}

export interface BankInput {
  entries: { id: string; kind: 'OPENING' | 'MONEY_IN' | 'MONEY_OUT'; occurredAt: Date; amount: number; description: string }[];
  orders: {
    id: string;
    orderNumber: string;
    paidAt: Date | null;
    updatedAt: Date;
    total: number;
    gatewayFee: number;
    refundedAmount: number;
    paymentMethod: string;
    customerName: string | null;
  }[];
  funding: { id: string; partnerName: string; type: string; amount: number; occurredAt: Date; description: string; throughBank: boolean; expenseId: string | null }[];
  expenses: { id: string; occurredAt: Date; amount: number; description: string; category: string; paidByPartnerId: string | null }[];
  payouts: { id: string; partnerName: string; amount: number; occurredAt: Date; note: string | null; runId: string | null }[];
  repayments: { id: string; partnerName: string; amount: number; occurredAt: Date; note: string | null; fundingDescription: string }[];
  checks: { id: string; checkedAt: Date; statementBalance: number; bookBalance: number; note: string | null }[];
}

export interface BankSummary {
  /** False until an OPENING entry exists. Every figure below is then zero. */
  started: boolean;
  startedAt: Date | null;
  balance: number;
  /** Oldest first, each carrying the running balance. */
  movements: BankMovement[];
  lastCheck: (BankInput['checks'][number] & { difference: number }) | null;
}

export function computeBank(input: BankInput): BankSummary {
  const opening = input.entries.find((e) => e.kind === 'OPENING');
  if (!opening) return { started: false, startedAt: null, balance: 0, movements: [], lastCheck: null };

  const start = opening.occurredAt.getTime();
  const since = (d: Date | null) => d !== null && d.getTime() >= start;
  const moves: Omit<BankMovement, 'balance'>[] = [];

  for (const e of input.entries) {
    moves.push({
      key: `${e.kind}:${e.id}`,
      source: e.kind,
      occurredAt: e.occurredAt,
      amount: e.kind === 'MONEY_OUT' ? -e.amount : e.amount,
      description: e.description,
      partnerName: null,
      ref: { type: 'bank_entry', id: e.id },
    });
  }

  for (const o of input.orders) {
    if (o.paymentMethod === 'CRYPTO' || !since(o.paidAt)) continue;
    // What actually lands: the gateway keeps its fee out of the settlement.
    moves.push({
      key: `SALE:${o.id}`,
      source: 'SALE',
      occurredAt: o.paidAt as Date,
      amount: o.total - o.gatewayFee,
      description: o.customerName ? `${o.orderNumber} · ${o.customerName}` : o.orderNumber,
      partnerName: null,
      ref: { type: 'order', id: o.id, label: o.orderNumber },
    });
    if (o.refundedAmount > 0) {
      // There is no refundedAt; the order's last update is when the refund
      // was recorded, which is the closest thing the data has.
      moves.push({
        key: `REFUND:${o.id}`,
        source: 'REFUND',
        occurredAt: o.updatedAt,
        amount: -o.refundedAmount,
        description: `Refund · ${o.orderNumber}`,
        partnerName: null,
        ref: { type: 'order', id: o.id, label: o.orderNumber },
      });
    }
  }

  for (const f of input.funding) {
    if (!f.throughBank || f.expenseId || !since(f.occurredAt)) continue;
    moves.push({
      key: `CAPITAL:${f.id}`,
      source: 'CAPITAL',
      occurredAt: f.occurredAt,
      amount: f.amount,
      description: f.description,
      partnerName: f.partnerName,
      ref: { type: 'funding', id: f.id },
    });
  }

  for (const e of input.expenses) {
    // An expense a partner paid personally never touched the bank: it is a
    // debt to them (or their contribution), and repaying it is the movement.
    if (e.paidByPartnerId || !since(e.occurredAt)) continue;
    moves.push({
      key: `EXPENSE:${e.id}`,
      source: 'EXPENSE',
      occurredAt: e.occurredAt,
      amount: -e.amount,
      description: `${e.category} · ${e.description}`,
      partnerName: null,
      ref: { type: 'expense', id: e.id },
    });
  }

  for (const p of input.payouts) {
    if (!since(p.occurredAt)) continue;
    moves.push({
      key: `PAYOUT:${p.id}`,
      source: 'PAYOUT',
      occurredAt: p.occurredAt,
      amount: -p.amount,
      description: p.runId ? 'Profit share-out' : p.note || 'Profit paid on account',
      partnerName: p.partnerName,
      ref: p.runId ? { type: 'payout_run', id: p.runId } : { type: 'payout', id: p.id },
    });
  }

  for (const r of input.repayments) {
    if (!since(r.occurredAt)) continue;
    moves.push({
      key: `REPAYMENT:${r.id}`,
      source: 'REPAYMENT',
      occurredAt: r.occurredAt,
      amount: -r.amount,
      description: r.note || `Repaid: ${r.fundingDescription}`,
      partnerName: r.partnerName,
      ref: { type: 'repayment', id: r.id },
    });
  }

  // OPENING first on its own date, then by time. Ties keep a stable order so
  // the running balance on the page doesn't reshuffle between loads.
  moves.sort(
    (a, b) =>
      Number(b.source === 'OPENING') - Number(a.source === 'OPENING') ||
      a.occurredAt.getTime() - b.occurredAt.getTime() ||
      a.key.localeCompare(b.key)
  );

  let balance = 0;
  const movements = moves.map((m) => ({ ...m, balance: (balance += m.amount) }));

  const latest = [...input.checks].sort((a, b) => b.checkedAt.getTime() - a.checkedAt.getTime())[0];
  return {
    started: true,
    startedAt: opening.occurredAt,
    balance,
    movements,
    // The difference against the book balance as it was when the statement
    // was read: later movements must not make an old check look wrong.
    lastCheck: latest ? { ...latest, difference: latest.statementBalance - latest.bookBalance } : null,
  };
}

/** In and out over [from, to) — for a month figure or a period picker. */
export function bankFlows(movements: BankMovement[], from: Date | null, to: Date | null) {
  let moneyIn = 0;
  let moneyOut = 0;
  let opening: number | null = null;
  for (const m of movements) {
    const t = m.occurredAt.getTime();
    if (from && t < from.getTime()) {
      opening = m.balance;
      continue;
    }
    if (to && t >= to.getTime()) continue;
    // The opening balance is where the account started, not money that came
    // in during the period.
    if (m.source === 'OPENING') {
      opening = m.amount;
      continue;
    }
    if (m.amount >= 0) moneyIn += m.amount;
    else moneyOut += -m.amount;
  }
  const start = opening ?? 0;
  return { opening: start, moneyIn, moneyOut, closing: start + moneyIn - moneyOut };
}

export async function loadBankInput(fastify: FastifyInstance): Promise<BankInput> {
  const prisma = fastify.prisma;
  const opening = await prisma.bankEntry.findFirst({ where: { kind: 'OPENING' }, select: { occurredAt: true } });
  // Before the bank starts there is nothing to read past the entries table.
  const start = opening?.occurredAt ?? new Date(8.64e15);

  const [entries, orders, funding, expenses, payouts, repayments, checks] = await Promise.all([
    prisma.bankEntry.findMany(),
    prisma.order.findMany({
      where: { deletedAt: null, paymentStatus: { in: ['PAID', 'REFUNDED'] }, paidAt: { gte: start } },
      select: {
        id: true, orderNumber: true, paidAt: true, updatedAt: true, total: true, gatewayFee: true,
        refundedAmount: true, paymentMethod: true, customerName: true,
      },
    }),
    prisma.partnerFunding.findMany({
      where: { occurredAt: { gte: start } },
      include: { partner: { select: { name: true } } },
    }),
    prisma.companyExpense.findMany({ where: { occurredAt: { gte: start } } }),
    prisma.profitPayout.findMany({ where: { occurredAt: { gte: start } }, include: { partner: { select: { name: true } } } }),
    prisma.partnerRepayment.findMany({
      where: { occurredAt: { gte: start } },
      include: { funding: { select: { description: true, partner: { select: { name: true } } } } },
    }),
    prisma.bankCheck.findMany(),
  ]);

  return {
    entries,
    orders,
    funding: funding.map((f) => ({ ...f, partnerName: f.partner.name })),
    expenses,
    payouts: payouts.map((p) => ({ ...p, partnerName: p.partner.name })),
    repayments: repayments.map((r) => ({
      ...r,
      partnerName: r.funding.partner.name,
      fundingDescription: r.funding.description,
    })),
    checks,
  };
}

export async function loadBank(fastify: FastifyInstance): Promise<BankSummary> {
  return computeBank(await loadBankInput(fastify));
}
