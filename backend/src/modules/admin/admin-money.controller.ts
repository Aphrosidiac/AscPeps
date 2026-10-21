/**
 * Ascend Money: the bank, the split rule and sharing profit out.
 *
 * The lifetime partner maths stays in admin-finance.controller.ts and
 * utils/finance.ts; this file adds what Ascend's own bank account brought
 * (docs/ascend-bank-plan.md):
 *
 *  - the bank ledger and its balance (derived — utils/bank.ts), plus the two
 *    things only a person can tell it: the opening balance and odd movements,
 *    and what the statement actually says;
 *  - the default split, versioned (utils/split-rules.ts);
 *  - share-outs: paying each person their part of a set of orders from the
 *    bank in one step, which is also what marks those orders shared. Before
 *    this, "Profit Shared" was a checkbox that paid nobody and a payout was an
 *    amount that settled no order.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { computeFinance } from '../../utils/finance.js';
import { costOrder, allocate } from '../../utils/profit.js';
import { bankFlows, loadBank } from '../../utils/bank.js';
import { loadSplitRules, ruleAt, sortShares } from '../../utils/split-rules.js';
import { loadFinanceInput } from './admin-finance.controller.js';

const moneyCents = z.number().int().min(1).max(1_000_000_000);

const periodSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

const bankEntrySchema = z.object({
  kind: z.enum(['OPENING', 'MONEY_IN', 'MONEY_OUT']),
  occurredAt: z.coerce.date(),
  // The opening balance may genuinely be zero; every other movement is not.
  amount: z.number().int().min(0).max(1_000_000_000),
  description: z.string().trim().max(300).optional(),
});

const bankCheckSchema = z.object({
  checkedAt: z.coerce.date().optional(),
  // Negative is a real overdraft, not an error.
  statementBalance: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  note: z.string().trim().max(300).nullable().optional(),
});

const splitRuleSchema = z.object({
  effectiveFrom: z.coerce.date(),
  note: z.string().trim().max(200).nullable().optional(),
  shares: z
    .array(z.object({ partnerId: z.string().min(1), shareBps: z.number().int().min(0).max(10_000) }))
    .min(1)
    .max(10),
});

const shareOutSchema = z.object({
  orderIds: z.array(z.string().min(1)).min(1).max(500),
  occurredAt: z.coerce.date().optional(),
  note: z.string().trim().max(300).nullable().optional(),
  // "Already paid outside the system": marks the orders shared with no payouts
  // and nothing leaving the bank. For orders settled by hand before the bank.
  outsideSystem: z.boolean().optional(),
});

/* ------------------------------------------------------------------ queue */

/** Everything an order needs to be judged for sharing, and its split worked out. */
async function loadShareable(fastify: FastifyInstance, where: Record<string, unknown>) {
  const orders = await fastify.prisma.order.findMany({
    where: { deletedAt: null, paymentStatus: { in: ['PAID', 'REFUNDED'] }, ...where },
    select: {
      id: true, orderNumber: true, customerName: true, status: true, paymentStatus: true, paidAt: true, createdAt: true,
      total: true, gatewayFee: true, refundedAmount: true, stockRestored: true, profitShared: true, payoutRunId: true,
      items: { select: { quantity: true, unitCost: true, unitPrice: true } },
      extraCosts: { select: { amount: true } },
      profitShares: { select: { partnerId: true, name: true, shareBps: true, partner: { select: { name: true, kind: true } } } },
    },
    orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
  });

  return orders.map((o) => {
    const costing = costOrder(o);
    const shares = o.profitShares.filter((s) => s.partnerId && s.partner);
    const amounts = costing.profit === null ? [] : allocate(costing.profit, shares.map((s) => s.shareBps));
    const parts = sortShares(
      shares.map((s, i) => ({
        partnerId: s.partnerId as string,
        name: s.partner!.name,
        kind: s.partner!.kind,
        shareBps: s.shareBps,
        amount: amounts[i] ?? null,
      }))
    );
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      customerName: o.customerName,
      status: o.status,
      paymentStatus: o.paymentStatus,
      paidAt: o.paidAt ?? o.createdAt,
      revenue: costing.revenue,
      profit: costing.profit,
      costed: costing.costed,
      shared: o.profitShared,
      payoutRunId: o.payoutRunId,
      parts,
      // Delivered, or refunded (nothing more will happen to it): the money is
      // final. Shipped orders still wait — a return would change the profit.
      settled: o.status === 'DELIVERED' || o.paymentStatus === 'REFUNDED',
    };
  });
}

export async function getShareOut(fastify: FastifyInstance) {
  await loadFinanceInput(fastify); // runs the default-split sweep
  const open = await loadShareable(fastify, { profitShared: false });

  // A split only counts when every row points at a partner and they total
  // 100% — rows typed before partners existed carry only a name, and an order
  // whose split is broken must show up as work, not drop out of every list.
  const splitOk = (o: (typeof open)[number]) => o.parts.length > 0 && o.parts.reduce((s, p) => s + p.shareBps, 0) === 10_000;
  const ready = open.filter((o) => o.costed && o.settled && splitOk(o));
  const waiting = {
    needsSplit: open.filter((o) => o.costed && !splitOk(o)).map((o) => ({ id: o.id, orderNumber: o.orderNumber, paidAt: o.paidAt })),
    needsCosting: open.filter((o) => !o.costed).map((o) => ({ id: o.id, orderNumber: o.orderNumber, paidAt: o.paidAt })),
    onTheWay: open
      .filter((o) => o.costed && !o.settled && splitOk(o))
      .map((o) => ({ id: o.id, orderNumber: o.orderNumber, status: o.status, paidAt: o.paidAt })),
  };

  const runs = await fastify.prisma.payoutRun.findMany({
    orderBy: { occurredAt: 'desc' },
    take: 50,
    include: {
      payouts: { include: { partner: { select: { name: true } } } },
      orders: { select: { id: true, orderNumber: true }, orderBy: { orderNumber: 'asc' } },
    },
  });

  return {
    ready,
    waiting,
    runs: runs.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt,
      note: r.note,
      legacy: r.legacy,
      createdBy: r.createdBy,
      total: r.payouts.reduce((s, p) => s + p.amount, 0),
      payouts: r.payouts.map((p) => ({ partnerId: p.partnerId, name: p.partner.name, amount: p.amount })),
      orders: r.orders,
    })),
  };
}

/**
 * Pay each person their part of these orders from the bank, and mark the
 * orders shared — one step, one transaction. Ascend's part is not paid to
 * anyone: it is what stays.
 */
export async function createShareOut(fastify: FastifyInstance, body: unknown, actor: string | null) {
  const data = shareOutSchema.parse(body);
  const ids = [...new Set(data.orderIds)];
  const orders = await loadShareable(fastify, { id: { in: ids } });

  const missing = ids.filter((id) => !orders.some((o) => o.id === id));
  if (missing.length) throw { statusCode: 400, message: `${missing.length} of those orders are not paid orders.` };

  const alreadyShared = orders.filter((o) => o.shared);
  if (alreadyShared.length) {
    throw { statusCode: 400, message: `Already shared out: ${alreadyShared.map((o) => o.orderNumber).join(', ')}.` };
  }

  const perPerson = new Map<string, { name: string; amount: number }>();
  let kept = 0;
  if (!data.outsideSystem) {
    const notReady = orders.filter((o) => !o.costed || o.parts.length === 0);
    if (notReady.length) {
      throw {
        statusCode: 400,
        message: `Not costed or no split yet: ${notReady.map((o) => o.orderNumber).join(', ')}. Their profit isn't known, so it can't be shared.`,
      };
    }
    for (const o of orders) {
      for (const part of o.parts) {
        if (part.kind === 'COMPANY') {
          kept += part.amount ?? 0;
          continue;
        }
        const cur = perPerson.get(part.partnerId) ?? { name: part.name, amount: 0 };
        cur.amount += part.amount ?? 0;
        perPerson.set(part.partnerId, cur);
      }
    }
    const negative = [...perPerson.values()].filter((p) => p.amount < 0);
    if (negative.length) {
      throw {
        statusCode: 400,
        message: `These orders lost money overall for ${negative.map((p) => p.name).join(' and ')} — leave the loss-making ones out, or record them as shared outside the system.`,
      };
    }
  }

  const occurredAt = data.occurredAt ?? new Date();
  const run = await fastify.prisma.$transaction(async (tx) => {
    const created = await tx.payoutRun.create({
      data: { occurredAt, note: data.note ?? null, legacy: !!data.outsideSystem, createdBy: actor },
    });
    const payouts = [...perPerson.entries()].filter(([, p]) => p.amount > 0);
    if (payouts.length) {
      await tx.profitPayout.createMany({
        data: payouts.map(([partnerId, p]) => ({
          partnerId,
          amount: p.amount,
          occurredAt,
          note: data.note ?? null,
          runId: created.id,
        })),
      });
    }
    // Guarded on profitShared: a second share-out racing this one for the
    // same orders must fail, not pay twice.
    const { count } = await tx.order.updateMany({
      where: { id: { in: ids }, profitShared: false },
      data: { profitShared: true, payoutRunId: created.id },
    });
    if (count !== ids.length) throw { statusCode: 409, message: 'Some of these orders were shared out a moment ago. Reload and try again.' };
    return created;
  });

  const bank = await loadBank(fastify);
  return {
    runId: run.id,
    orders: orders.length,
    payouts: [...perPerson.values()].filter((p) => p.amount > 0),
    kept,
    bankBalance: bank.started ? bank.balance : null,
    warning: bank.started && bank.balance < 0 ? 'The bank balance is now below zero — a movement is probably missing.' : null,
  };
}

/** Undo a share-out: its payouts go, its orders go back to unshared. */
export async function deleteShareOut(fastify: FastifyInstance, id: string) {
  const run = await fastify.prisma.payoutRun.findUnique({ where: { id }, select: { id: true, createdBy: true } });
  if (!run) throw { statusCode: 404, message: 'Share-out not found' };
  // The cutover's record of everything shared by hand before the bank. On
  // prod it holds 69 orders; undoing it would put months of settled profit
  // back into what people are owed.
  if (run.createdBy === 'cutover') {
    throw { statusCode: 400, message: 'This is the record of orders shared by hand before Ascend’s bank. It cannot be undone here.' };
  }
  await fastify.prisma.$transaction([
    fastify.prisma.order.updateMany({ where: { payoutRunId: id }, data: { payoutRunId: null, profitShared: false } }),
    // Payouts cascade with the run.
    fastify.prisma.payoutRun.delete({ where: { id } }),
  ]);
  return { success: true };
}

/**
 * The old "Profit Shared" tick, kept for orders settled by hand (the orders
 * list, the assistant's set_profit_shared). Ticking puts the orders in one
 * "shared outside the system" run; unticking takes them out of theirs — but
 * only of a run that paid nobody. An order whose profit went out through a
 * real share-out is unshared by undoing that share-out, so the payouts go too.
 */
export async function setOrdersSharedOutside(
  fastify: FastifyInstance,
  orderIds: string[],
  shared: boolean,
  actor: string | null,
  note?: string
) {
  const orders = await fastify.prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, orderNumber: true, profitShared: true, payoutRun: { select: { id: true, legacy: true, occurredAt: true } } },
  });

  if (shared) {
    const todo = orders.filter((o) => !o.profitShared).map((o) => o.id);
    if (todo.length === 0) return { changed: 0 };
    await createShareOut(fastify, { orderIds: todo, outsideSystem: true, note: note ?? 'Shared outside the system' }, actor);
    return { changed: todo.length };
  }

  const paid = orders.filter((o) => o.payoutRun && !o.payoutRun.legacy);
  if (paid.length) {
    throw {
      statusCode: 400,
      message: `${paid.map((o) => o.orderNumber).join(', ')} went out in a share-out — undo that share-out on Ascend Money instead, so its payouts go with it.`,
    };
  }
  const todo = orders.filter((o) => o.profitShared);
  const runIds = [...new Set(todo.map((o) => o.payoutRun?.id).filter(Boolean))] as string[];
  await fastify.prisma.$transaction(async (tx) => {
    await tx.order.updateMany({ where: { id: { in: todo.map((o) => o.id) } }, data: { profitShared: false, payoutRunId: null } });
    // A legacy run left with no orders means nothing; drop it.
    if (runIds.length) await tx.payoutRun.deleteMany({ where: { id: { in: runIds }, orders: { none: {} } } });
  });
  return { changed: todo.length };
}

/* ------------------------------------------------------------------- bank */

export async function getBankLedger(fastify: FastifyInstance, query: unknown) {
  const { from, to } = periodSchema.parse(query);
  const [bank, checks] = await Promise.all([
    loadBank(fastify),
    fastify.prisma.bankCheck.findMany({ orderBy: { checkedAt: 'desc' } }),
  ]);
  const movements = bank.movements.filter(
    (m) => (!from || m.occurredAt >= from) && (!to || m.occurredAt < to)
  );
  return {
    started: bank.started,
    startedAt: bank.startedAt,
    balance: bank.balance,
    flows: bankFlows(bank.movements, from ?? null, to ?? null),
    // Newest first for the page; each row keeps its running balance.
    movements: [...movements].reverse(),
    checks: checks.map((c) => ({ ...c, difference: c.statementBalance - c.bookBalance })),
    lastCheck: bank.lastCheck,
  };
}

export async function createBankEntry(fastify: FastifyInstance, body: unknown, actor: string | null) {
  const data = bankEntrySchema.parse(body);
  if (data.kind === 'OPENING') {
    const existing = await fastify.prisma.bankEntry.findFirst({ where: { kind: 'OPENING' } });
    if (existing) throw { statusCode: 400, message: 'The bank already has an opening balance. Delete it first to change it.' };
  } else {
    if (data.amount < 1) throw { statusCode: 400, message: 'Enter an amount.' };
    if (!data.description) throw { statusCode: 400, message: 'Say what it was for.' };
    const opening = await fastify.prisma.bankEntry.findFirst({ where: { kind: 'OPENING' } });
    if (!opening) throw { statusCode: 400, message: 'Record the opening balance first.' };
    if (data.occurredAt < opening.occurredAt) {
      throw { statusCode: 400, message: 'That is before the bank was started — it would not count.' };
    }
  }
  return fastify.prisma.bankEntry.create({
    data: {
      kind: data.kind,
      occurredAt: data.occurredAt,
      amount: data.amount,
      description: data.description || 'Opening balance',
      createdBy: actor,
    },
  });
}

export async function deleteBankEntry(fastify: FastifyInstance, id: string) {
  const entry = await fastify.prisma.bankEntry.findUnique({ where: { id } });
  if (!entry) throw { statusCode: 404, message: 'Entry not found' };
  if (entry.kind === 'OPENING') {
    const others = await fastify.prisma.bankEntry.count({ where: { kind: { not: 'OPENING' } } });
    if (others) throw { statusCode: 400, message: 'Other bank entries depend on the opening balance. Delete those first.' };
  }
  await fastify.prisma.bankEntry.delete({ where: { id } });
  return { success: true };
}

export async function createBankCheck(fastify: FastifyInstance, body: unknown, actor: string | null) {
  const data = bankCheckSchema.parse(body);
  const bank = await loadBank(fastify);
  if (!bank.started) throw { statusCode: 400, message: 'Record the opening balance first.' };
  const checkedAt = data.checkedAt ?? new Date();
  // The book balance as of the moment the statement was read, not as of now:
  // a check dated yesterday compares against yesterday's balance.
  const bookBalance = bank.movements.filter((m) => m.occurredAt <= checkedAt).at(-1)?.balance ?? 0;
  const check = await fastify.prisma.bankCheck.create({
    data: { checkedAt, statementBalance: data.statementBalance, bookBalance, note: data.note ?? null, createdBy: actor },
  });
  return { ...check, difference: check.statementBalance - check.bookBalance };
}

export async function deleteBankCheck(fastify: FastifyInstance, id: string) {
  const check = await fastify.prisma.bankCheck.findUnique({ where: { id } });
  if (!check) throw { statusCode: 404, message: 'Check not found' };
  await fastify.prisma.bankCheck.delete({ where: { id } });
  return { success: true };
}

/* -------------------------------------------------------------- split rule */

export async function listSplitRules(fastify: FastifyInstance) {
  const rules = await loadSplitRules(fastify.prisma);
  return { current: ruleAt(rules, new Date()), rules };
}

/**
 * A new version of the default split, from a date. Never rewrites an order
 * that already has a split; only orders paid from `effectiveFrom` that have
 * none yet get it.
 */
export async function createSplitRule(fastify: FastifyInstance, body: unknown, actor: string | null) {
  const data = splitRuleSchema.parse(body);
  const total = data.shares.reduce((s, x) => s + x.shareBps, 0);
  if (total !== 10_000) throw { statusCode: 400, message: `Shares must add up to exactly 100% — currently ${(total / 100).toFixed(2)}%.` };
  const ids = data.shares.map((s) => s.partnerId);
  if (new Set(ids).size !== ids.length) throw { statusCode: 400, message: 'Each person can only appear once.' };
  const partners = await fastify.prisma.partner.findMany({ where: { id: { in: ids } } });
  if (partners.length !== ids.length) throw { statusCode: 400, message: 'One of those partners does not exist.' };
  const inactive = partners.filter((p) => !p.active);
  if (inactive.length) throw { statusCode: 400, message: `${inactive.map((p) => p.name).join(', ')} is marked inactive.` };

  const rule = await fastify.prisma.profitSplitRule.create({
    data: {
      effectiveFrom: data.effectiveFrom,
      note: data.note ?? null,
      createdBy: actor,
      // Zero shares are dropped: a 0% line is noise on every order it lands on.
      shares: { create: data.shares.filter((s) => s.shareBps > 0).map((s) => ({ partnerId: s.partnerId, shareBps: s.shareBps })) },
    },
  });
  return { id: rule.id, ...(await listSplitRules(fastify)) };
}

export async function deleteSplitRule(fastify: FastifyInstance, id: string) {
  const rule = await fastify.prisma.profitSplitRule.findUnique({ where: { id } });
  if (!rule) throw { statusCode: 404, message: 'Rule not found' };
  // Orders already given this rule keep their split — splits are copies. Only
  // a rule that has not taken effect yet can be withdrawn; an old one is
  // history and is replaced by adding a newer version instead.
  if (rule.effectiveFrom <= new Date()) {
    throw { statusCode: 400, message: 'This rule is already in effect. Add a new version from a later date instead.' };
  }
  await fastify.prisma.profitSplitRule.delete({ where: { id } });
  return { success: true };
}

/* --------------------------------------------------------------- overview */

/**
 * The page's first screen: the bank, what is waiting to be shared, what each
 * person is owed, and a P&L for the chosen period. Balances are lifetime
 * (what is owed now does not depend on the period); the P&L is the period.
 */
export async function getMoneyOverview(fastify: FastifyInstance, query: unknown) {
  const { from, to } = periodSchema.parse(query);
  const input = await loadFinanceInput(fastify);
  const lifetime = computeFinance(input);

  const inPeriod = (d: Date) => (!from || d >= from) && (!to || d < to);
  const period = from || to
    ? computeFinance({
        ...input,
        // By when the money arrived, the same rule as the bank.
        orders: input.orders.filter((o) => inPeriod(o.paidAt ?? o.createdAt)),
        expenses: input.expenses.filter((e) => inPeriod(e.occurredAt)),
        funding: [],
        payouts: [],
      })
    : lifetime;

  const [bank, share, rules] = await Promise.all([loadBank(fastify), getShareOut(fastify), loadSplitRules(fastify.prisma)]);

  const readyPeople = new Map<string, { partnerId: string; name: string; amount: number }>();
  let readyAscend = 0;
  for (const o of share.ready) {
    for (const p of o.parts) {
      if (p.kind === 'COMPANY') {
        readyAscend += p.amount ?? 0;
        continue;
      }
      const cur = readyPeople.get(p.partnerId) ?? { partnerId: p.partnerId, name: p.name, amount: 0 };
      cur.amount += p.amount ?? 0;
      readyPeople.set(p.partnerId, cur);
    }
  }

  const daysSinceCheck = bank.lastCheck ? Math.floor((Date.now() - bank.lastCheck.checkedAt.getTime()) / 86_400_000) : null;

  return {
    period: {
      from: from ?? null,
      to: to ?? null,
      revenue: period.revenue,
      refunded: period.refunded,
      costedRevenue: period.costedRevenue,
      uncostedRevenue: period.uncostedRevenue,
      cogs: period.cogs,
      extraCosts: period.extraCosts,
      gatewayFees: period.gatewayFees,
      grossOrderProfit: period.grossOrderProfit,
      operatingSpend: period.operatingSpend,
      inventoryPurchased: period.inventoryPurchased,
      netProfit: period.netProfit,
      costedOrders: period.costedOrders,
      uncostedOrders: period.uncostedOrders,
      ascendKept: period.ascend?.retained ?? 0,
      earnedByPerson: period.partners.filter((p) => p.earned !== 0).map((p) => ({ partnerId: p.partnerId, name: p.name, earned: p.earned })),
    },
    bank: {
      started: bank.started,
      startedAt: bank.startedAt,
      balance: bank.balance,
      flows: bankFlows(bank.movements, from ?? null, to ?? null),
      lastCheck: bank.lastCheck,
      daysSinceCheck,
      recent: [...bank.movements].reverse().slice(0, 8),
    },
    ascend: lifetime.ascend,
    partners: lifetime.partners,
    stockOnHand: lifetime.stockOnHand,
    totalAdvancesOutstanding: lifetime.totalAdvancesOutstanding,
    readyToShare: {
      orders: share.ready.length,
      people: [...readyPeople.values()],
      ascend: readyAscend,
      total: [...readyPeople.values()].reduce((s, p) => s + p.amount, 0),
    },
    waiting: {
      needsCosting: share.waiting.needsCosting.length,
      needsSplit: share.waiting.needsSplit.length,
      onTheWay: share.waiting.onTheWay.length,
    },
    splitRule: ruleAt(rules, new Date()),
    nextSplitRule: [...rules].reverse().find((r) => r.effectiveFrom > new Date()) ?? null,
  };
}
