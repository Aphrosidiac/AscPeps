import type { AgentTool } from '../tool-kit.js';
import { clampLimit, money, parseDate, rm, toCents } from '../tool-kit.js';
import {
  createExpense,
  createFunding,
  createPayout,
  createRepayment,
  deleteExpense,
  deleteFunding,
  deletePayout,
  deleteRepayment,
  getPartnerDetail,
  listExpenses,
  saveFinancePartners,
} from '../../admin/admin-finance.controller.js';
import {
  createBankCheck,
  createBankEntry,
  createShareOut,
  createSplitRule,
  deleteShareOut,
  getBankLedger,
  getMoneyOverview,
  getShareOut,
  listSplitRules,
} from '../../admin/admin-money.controller.js';
import { fileReady, prepareFiling, shapeFiled } from './files.tools.js';
import { resolveOrder } from './orders.tools.js';
import { mytDateKey } from '../../../utils/delivery-slots.js';

// Finance tools move real money between real people, so every one of them
// delegates to admin-finance.controller.ts / admin-money.controller.ts — the
// balance maths (utils/finance.ts, utils/bank.ts) must have exactly one
// implementation.
//
// Since 2026-10-21 Ascend has its own bank account (docs/ascend-bank-plan.md):
// every customer payment lands there, it pays for stock and bills, and profit
// goes out to people from it in share-outs. Ascend is also a partner in the
// split (20% from 1 Nov) whose share simply stays in the bank.
//
// The distinction the tool descriptions work hardest to protect is
// CONTRIBUTION vs ADVANCE. A contribution is capital that is never repaid and
// never appears in "owed"; an advance is a debt. Recording one as the other
// silently corrupts what the business thinks it owes its partners, and nothing
// downstream will flag it.

async function resolvePartner(prisma: any, ref: string) {
  const raw = String(ref).trim();
  const p = await prisma.partner.findFirst({
    where: { OR: [{ id: raw }, { name: { equals: raw, mode: 'insensitive' } }, { name: { contains: raw, mode: 'insensitive' } }] },
  });
  if (!p) {
    const all = await prisma.partner.findMany({ select: { name: true } });
    throw new Error(`No partner matching "${ref}". Known partners: ${all.map((x: any) => x.name).join(', ') || '(none yet)'}.`);
  }
  return p;
}

export const financeTools: AgentTool[] = [
  {
    name: 'finance_overview',
    description:
      'The money picture: Ascend\'s bank balance, what is ready to share out and to whom, what each person is owed right now (unshared profit + loans to Ascend not repaid), what Ascend has kept, the default split, and profit for a period. Start here for any "how are we doing", "what do I owe" or "berapa dalam bank" question. Pass from/to (YYYY-MM-DD) for a period\'s profit; balances are always as of now.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD, start of the period for the profit figures.' },
        to: { type: 'string', description: 'YYYY-MM-DD, last day of the period (inclusive).' },
      },
    },
    run: async ({ fastify }, input) => {
      const o: any = await getMoneyOverview(fastify, {
        ...(input.from ? { from: parseDate(input.from, false)!.toISOString() } : {}),
        ...(input.to ? { to: new Date(parseDate(input.to, true)!.getTime() + 1).toISOString() } : {}),
      });
      return {
        bank: o.bank.started
          ? {
              balance: money(o.bank.balance),
              trackedSince: o.bank.startedAt,
              lastStatementCheck: o.bank.lastCheck
                ? { on: o.bank.lastCheck.checkedAt, statement: money(o.bank.lastCheck.statementBalance), difference: money(o.bank.lastCheck.difference) }
                : null,
            }
          : 'Not tracked yet — the opening balance has not been entered.',
        readyToShare: {
          orders: o.readyToShare.orders,
          payTo: o.readyToShare.people.map((p: any) => ({ name: p.name, amount: money(p.amount) })),
          ascendKeeps: money(o.readyToShare.ascend),
        },
        waiting: o.waiting,
        owedNow: o.partners
          .filter((p: any) => p.owed !== 0 || p.earned !== 0)
          .map((p: any) => ({
            name: p.name,
            owed: money(p.owed),
            unsharedProfit: money(p.toShare),
            lentToAscendNotRepaid: money(p.advancesOutstanding),
            earnedAllTime: money(p.earned),
          })),
        ascendKept: o.ascend ? money(o.ascend.retained) : null,
        splitNow: o.splitRule?.shares.map((s: any) => `${s.name} ${s.shareBps / 100}%`).join(', ') ?? null,
        splitNext: o.nextSplitRule
          ? { from: o.nextSplitRule.effectiveFrom, shares: o.nextSplitRule.shares.map((s: any) => `${s.name} ${s.shareBps / 100}%`).join(', ') }
          : null,
        profit: {
          period: input.from || input.to ? { from: input.from ?? null, to: input.to ?? null } : 'all time',
          revenue: money(o.period.revenue),
          notCostedRevenue: money(o.period.uncostedRevenue),
          profitFromOrders: money(o.period.grossOrderProfit),
          runningCosts: money(o.period.operatingSpend),
          netProfit: money(o.period.netProfit),
          byPerson: o.period.earnedByPerson.map((p: any) => ({ name: p.name, earned: money(p.earned) })),
          ascendKept: money(o.period.ascendKept),
        },
      };
    },
  },

  {
    name: 'bank_overview',
    description:
      'Ascend\'s bank account: the balance, money in and out over a period, the last statement check, and the latest movements (customer payments, refunds, partner capital, stock and bills paid, profit shares, repayments). Customer payments are added automatically, net of the gateway fee. Use for "how much is in the bank", "what went out this week".',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD' },
        to: { type: 'string', description: 'YYYY-MM-DD, inclusive' },
        limit: { type: 'number', description: 'Movements to list, newest first. Default 15.' },
      },
    },
    run: async ({ fastify }, input) => {
      const l: any = await getBankLedger(fastify, {
        ...(input.from ? { from: parseDate(input.from, false)!.toISOString() } : {}),
        ...(input.to ? { to: new Date(parseDate(input.to, true)!.getTime() + 1).toISOString() } : {}),
      });
      if (!l.started) return { started: false, note: 'The bank is not tracked yet — someone has to enter the opening balance on Ascend Money.' };
      return {
        balance: money(l.balance),
        trackedSince: l.startedAt,
        period: { opening: money(l.flows.opening), in: money(l.flows.moneyIn), out: money(l.flows.moneyOut), closing: money(l.flows.closing) },
        lastStatementCheck: l.lastCheck ? { on: l.lastCheck.checkedAt, difference: money(l.lastCheck.difference) } : null,
        movements: l.movements.slice(0, clampLimit(input.limit, 15)).map((m: any) => ({
          on: m.occurredAt,
          kind: m.source,
          what: m.partnerName ? `${m.partnerName} · ${m.description}` : m.description,
          amount: money(m.amount),
          balanceAfter: money(m.balance),
        })),
      };
    },
  },

  {
    name: 'ready_to_share',
    description:
      'Orders whose profit is ready to go out (paid, delivered, costed, not shared yet), with each person\'s part and what Ascend keeps; plus what is not ready yet and why. Use before share_out_profit, and for "how much do I get", "dah boleh bagi profit?".',
    input_schema: { type: 'object', properties: {} },
    run: async ({ fastify }) => {
      const q: any = await getShareOut(fastify);
      const people = new Map<string, number>();
      let kept = 0;
      for (const o of q.ready) for (const p of o.parts) {
        if (p.kind === 'COMPANY') kept += p.amount ?? 0;
        else people.set(p.name, (people.get(p.name) ?? 0) + (p.amount ?? 0));
      }
      return {
        orders: q.ready.map((o: any) => ({
          orderNumber: o.orderNumber,
          profit: money(o.profit ?? 0),
          parts: o.parts.map((p: any) => `${p.kind === 'COMPANY' ? 'Ascend keeps' : p.name} ${rm(p.amount ?? 0)}`).join(', '),
        })),
        totals: { payTo: [...people].map(([name, amount]) => ({ name, amount: money(amount) })), ascendKeeps: money(kept) },
        notReady: {
          needsCosting: q.waiting.needsCosting.map((o: any) => o.orderNumber),
          splitNeedsFixing: q.waiting.needsSplit.map((o: any) => o.orderNumber),
          notDeliveredYet: q.waiting.onTheWay.map((o: any) => o.orderNumber),
        },
      };
    },
  },

  {
    name: 'share_out_profit',
    description:
      'Pay each person their share of a set of orders FROM ASCEND\'S BANK, and mark those orders shared — one step. Ascend\'s own share stays in the bank. Leave orderRefs out to share every order that is ready (ready_to_share). Only for money actually going out now; for orders already settled by hand use set_profit_shared. Needs the operator\'s yes.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        orderRefs: { type: 'array', items: { type: 'string' }, description: 'Order numbers. Omit = every ready order.' },
        occurredAt: { type: 'string', description: 'YYYY-MM-DD the money went out. Defaults to today.' },
        note: { type: 'string', description: 'e.g. "October"' },
      },
    },
    summarize: async (ctx, input) => {
      const ids = await shareOutIds(ctx, input.orderRefs);
      const q: any = await getShareOut(ctx.fastify);
      const people = new Map<string, number>();
      let kept = 0;
      for (const o of q.ready.filter((o: any) => ids.includes(o.id))) for (const p of o.parts) {
        if (p.kind === 'COMPANY') kept += p.amount ?? 0;
        else people.set(p.name, (people.get(p.name) ?? 0) + (p.amount ?? 0));
      }
      const pays = [...people].filter(([, a]) => a > 0).map(([n, a]) => `${n} ${rm(a)}`).join(' and ');
      return `pay ${pays || 'nobody'} from Ascend's bank for ${ids.length} order${ids.length === 1 ? '' : 's'}${kept ? ` (Ascend keeps ${rm(kept)})` : ''}`;
    },
    run: async (ctx, input) => {
      const ids = await shareOutIds(ctx, input.orderRefs);
      const r: any = await createShareOut(
        ctx.fastify,
        { orderIds: ids, occurredAt: parseDate(input.occurredAt ?? 'today', false), note: input.note ?? null },
        `Abby for ${ctx.actor.name || 'an operator'}`
      );
      return {
        shareOutId: r.runId,
        orders: r.orders,
        paid: r.payouts.map((p: any) => ({ name: p.name, amount: money(p.amount) })),
        ascendKept: money(r.kept),
        bankBalanceAfter: r.bankBalance === null ? null : money(r.bankBalance),
        ...(r.warning ? { warning: r.warning } : {}),
      };
    },
  },

  {
    name: 'undo_share_out',
    description: 'Undo a share-out entered by mistake: its payouts are deleted and its orders go back to ready. shareOutId from ready_to_share history or share_out_profit\'s result. Only when the money did not actually go out.',
    write: true,
    destructive: true,
    input_schema: { type: 'object', properties: { shareOutId: { type: 'string' } }, required: ['shareOutId'] },
    summarize: async ({ prisma }, input) => {
      const run = await prisma.payoutRun.findUnique({ where: { id: input.shareOutId }, include: { payouts: true, _count: { select: { orders: true } } } });
      if (!run) throw new Error(`No share-out with id ${input.shareOutId}.`);
      const total = run.payouts.reduce((s: number, p: any) => s + p.amount, 0);
      return `undo the share-out of ${mytDateKey(new Date(run.occurredAt))} (${run._count.orders} orders, ${rm(total)} paid) — payouts deleted, orders back to ready`;
    },
    run: async ({ fastify }, input) => deleteShareOut(fastify, input.shareOutId),
  },

  {
    name: 'record_bank_movement',
    description:
      'Money in or out of Ascend\'s bank that is NOT a customer payment, a partner putting money in (record_funding), a supplier or bill (record_expense) or a profit share (share_out_profit): bank charges, a transfer, crypto cashed in, a correction. kind OPENING is the one-time starting balance.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['MONEY_IN', 'MONEY_OUT', 'OPENING'] },
        amountRm: { type: 'number' },
        description: { type: 'string' },
        occurredAt: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
      },
      required: ['kind', 'amountRm'],
    },
    run: async ({ fastify, actor }, input) => {
      const row: any = await createBankEntry(
        fastify,
        {
          kind: input.kind,
          amount: toCents(input.amountRm),
          description: input.description,
          occurredAt: input.kind === 'OPENING' ? parseDate(input.occurredAt ?? 'today', false) : new Date(),
        },
        `Abby for ${actor.name || 'an operator'}`
      );
      return { entryId: row.id, kind: row.kind, amount: money(row.amount) };
    },
  },

  {
    name: 'check_bank_balance',
    description:
      'Record what the bank statement / bank app says the balance is, and compare it with Ascend Money. Use when an operator says "bank shows RM…" or sends a statement screenshot. A difference usually means a movement is not recorded, or a Billplz settlement has not landed yet.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        statementBalanceRm: { type: 'number' },
        note: { type: 'string' },
      },
      required: ['statementBalanceRm'],
    },
    run: async ({ fastify, actor }, input) => {
      const c: any = await createBankCheck(fastify, { statementBalance: toCents(input.statementBalanceRm), note: input.note ?? null }, `Abby for ${actor.name || 'an operator'}`);
      return {
        statement: money(c.statementBalance),
        ascendMoneySays: money(c.bookBalance),
        difference: money(c.difference),
        matches: c.difference === 0,
      };
    },
  },

  {
    name: 'get_split_rule',
    description: 'The default profit split: the one in effect now, any version starting later, and the history. Every paid order gets the version in effect on the day it was paid.',
    input_schema: { type: 'object', properties: {} },
    run: async ({ fastify }) => {
      const r: any = await listSplitRules(fastify);
      const shape = (rule: any) => ({
        from: new Date(rule.effectiveFrom).getFullYear() < 2000 ? 'the start' : rule.effectiveFrom,
        shares: rule.shares.map((s: any) => `${s.name} ${s.shareBps / 100}%`).join(', '),
        note: rule.note,
        by: rule.createdBy,
      });
      return { now: r.current ? shape(r.current) : null, versions: r.rules.map(shape) };
    },
  },

  {
    name: 'set_split_rule',
    description:
      'Change the default profit split from a date. Never changes orders that already have a split — only paid orders from that date on that have none. People must be existing partners; Ascend is "Ascend". Percentages total 100. Anyone may change it, but it needs the operator\'s yes.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        shares: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, percent: { type: 'number' } },
            required: ['name', 'percent'],
          },
        },
        from: { type: 'string', description: 'YYYY-MM-DD the new split starts. Defaults to today.' },
        note: { type: 'string' },
      },
      required: ['shares'],
    },
    summarize: async ({ prisma }, input) => {
      const parts = await resolveRuleShares(prisma, input.shares);
      return `change the default split from ${input.from ?? 'today'} to ${parts.map((p) => `${p.name} ${p.shareBps / 100}%`).join(', ')}`;
    },
    run: async ({ fastify, prisma, actor }, input) => {
      const parts = await resolveRuleShares(prisma, input.shares);
      await createSplitRule(
        fastify,
        {
          effectiveFrom: parseDate(input.from ?? 'today', false),
          note: input.note ?? null,
          shares: parts.map((p) => ({ partnerId: p.partnerId, shareBps: p.shareBps })),
        },
        `Abby for ${actor.name || 'an operator'}`
      );
      return { saved: true, from: input.from ?? 'today', shares: parts.map((p) => `${p.name} ${p.shareBps / 100}%`) };
    },
  },

  {
    name: 'get_partner',
    description:
      'One person\'s full finance record: what they have earned, capital they fronted to cover order costs, money they put in (contributions and advances), advances still outstanding, and profit paid out to them.',
    input_schema: {
      type: 'object',
      properties: { partnerRef: { type: 'string', description: 'Partner name or id.' } },
      required: ['partnerRef'],
    },
    run: async ({ fastify, prisma }, input) => {
      const p = await resolvePartner(prisma, input.partnerRef);
      return getPartnerDetail(fastify, p.id);
    },
  },

  {
    name: 'save_partners',
    description:
      'Create partners, rename them, deactivate them, or edit their notes. Send the full list of partners you want to exist — omitted existing partners are left alone only if you include them, so read the current list first with finance_overview.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        partners: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Omit to create a new partner.' },
              name: { type: 'string' },
              active: { type: 'boolean' },
              notes: { type: 'string' },
            },
            required: ['name', 'active'],
          },
        },
      },
      required: ['partners'],
    },
    run: async ({ fastify }, input) => saveFinancePartners(fastify, { partners: input.partners }),
  },

  {
    name: 'list_expenses',
    description: 'Company spending — ads, software, equipment, stock bought ahead of demand. Not order-level costs.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    run: async ({ fastify }, input) => {
      const query: Record<string, string> = {};
      if (input.category) query.category = input.category;
      if (input.from) query.from = parseDate(input.from, false)!.toISOString();
      if (input.to) query.to = parseDate(input.to, true)!.toISOString();
      query.limit = String(clampLimit(input.limit, 30));
      return listExpenses(fastify, query);
    },
  },

  {
    name: 'record_expense',
    description:
      'Record company spending — paid from Ascend\'s bank unless someone says they paid it themselves. Amount in RINGGIT. Paying a supplier for stock is category "Stock" (kind INVENTORY: a cost only as the goods sell). If a partner paid for it out of their own pocket, name them in paidByPartner AND say whether that was a CONTRIBUTION (they never want it back) or an ADVANCE (the company owes them) — getting that wrong misstates what the business owes. When the operator sent the receipt, bill or invoice for it in this conversation, pass its mediaId as receiptMediaId: the receipt is filed in the document store against this expense in the same step, and a receipt that is already in the books is refused before anything is recorded — so the same bill is never booked twice.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        amountRm: { type: 'number' },
        category: { type: 'string', description: 'e.g. Ads, Software, Equipment, Stock, Shipping.' },
        description: { type: 'string' },
        occurredAt: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
        paidByPartner: { type: 'string', description: 'Partner name, only if a person fronted the cash.' },
        paidByFundingType: {
          type: 'string',
          enum: ['CONTRIBUTION', 'ADVANCE'],
          description: 'Required when paidByPartner is set. ADVANCE creates a debt to that person; CONTRIBUTION does not.',
        },
        receiptMediaId: { type: 'string', description: 'The mediaId of the receipt/bill/invoice file the operator sent for this expense, to file it alongside.' },
        receiptKind: { type: 'string', description: 'What the file is: Receipt (default), Bill, Invoice, Bank slip.' },
      },
      required: ['amountRm', 'category', 'description'],
    },
    run: async (ctx, input) => {
      const { fastify, prisma } = ctx;
      // Checked BEFORE the expense exists: a receipt that is already filed, or
      // cannot be, stops the booking rather than leaving a half-done one.
      const receipt = input.receiptMediaId ? await prepareFiling(ctx, input.receiptMediaId) : null;
      let paidByPartnerId: string | null = null;
      if (input.paidByPartner) {
        if (!input.paidByFundingType) {
          throw new Error(
            'When a partner fronted the cash you must also say whether it was a CONTRIBUTION (never repaid) or an ADVANCE (a debt the company owes them).'
          );
        }
        paidByPartnerId = (await resolvePartner(prisma, input.paidByPartner)).id;
      }
      const row: any = await createExpense(fastify, {
        occurredAt: parseDate(input.occurredAt ?? 'today', false),
        category: input.category,
        description: input.description,
        amount: toCents(input.amountRm),
        // Stock bought is not a cost until it sells (bookkeeping.md §1).
        kind: /^stock$/i.test(String(input.category).trim()) ? 'INVENTORY' : 'OPERATING',
        paidByPartnerId,
        paidByFundingType: paidByPartnerId ? input.paidByFundingType : null,
      });
      const recorded = { expenseId: row.id, amount: money(row.amount), category: row.category, occurredAt: row.occurredAt };
      if (!receipt) return recorded;
      try {
        const doc = await fileReady(
          ctx,
          receipt,
          { title: input.description, kind: input.receiptKind || 'Receipt', occurredAt: row.occurredAt, amount: row.amount, description: null },
          { expenseIds: [row.id] }
        );
        return { ...recorded, receipt: shapeFiled(doc) };
      } catch (err: any) {
        // All or nothing: an expense whose receipt did not file is removed
        // again, so a retry cannot leave two copies of the same booking.
        await deleteExpense(fastify, row.id).catch(() => undefined);
        throw new Error(`Nothing was recorded — the receipt could not be filed: ${err?.message ?? err}`);
      }
    },
  },

  {
    name: 'delete_expense',
    description: 'Remove a company expense. Also removes the funding record if a partner had fronted it.',
    write: true,
    destructive: true,
    input_schema: { type: 'object', properties: { expenseId: { type: 'string' } }, required: ['expenseId'] },
    summarize: async ({ prisma }, input) => {
      const e = await prisma.companyExpense.findUnique({ where: { id: input.expenseId } });
      if (!e) throw new Error(`No expense with id ${input.expenseId}.`);
      return `delete the ${rm(e.amount)} expense "${e.description}" (${e.category})`;
    },
    run: async ({ fastify }, input) => {
      await deleteExpense(fastify, input.expenseId);
      return { deleted: true, expenseId: input.expenseId };
    },
  },

  {
    name: 'record_funding',
    description:
      'Record money a partner put into Ascend\'s bank. type CONTRIBUTION = their investment, never repaid, never counted in "owed". type ADVANCE = a loan to Ascend that Ascend repays (in parts is fine), tracked until repaid. Ask which one if the instruction is ambiguous — do not guess.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        partnerRef: { type: 'string' },
        type: { type: 'string', enum: ['CONTRIBUTION', 'ADVANCE'] },
        amountRm: { type: 'number' },
        description: { type: 'string' },
        occurredAt: { type: 'string', description: 'YYYY-MM-DD. Defaults to today.' },
      },
      required: ['partnerRef', 'type', 'amountRm', 'description'],
    },
    run: async ({ fastify, prisma }, input) => {
      const p = await resolvePartner(prisma, input.partnerRef);
      const row: any = await createFunding(fastify, {
        partnerId: p.id,
        type: input.type,
        amount: toCents(input.amountRm),
        occurredAt: parseDate(input.occurredAt ?? 'today', false),
        description: input.description,
      });
      return {
        fundingId: row.id,
        partner: p.name,
        type: row.type,
        amount: money(row.amount),
        note:
          row.type === 'ADVANCE'
            ? `The company now owes ${p.name} ${rm(row.amount)} until repaid.`
            : `Recorded as capital — this does not create a debt.`,
      };
    },
  },

  {
    name: 'record_repayment',
    description:
      'Repay part or all of a specific ADVANCE from Ascend\'s bank — including the capital Asywa fronted on orders before the bank, which became an advance. Partial repayment is normal — outstanding is derived from the advance minus its repayments. Get fundingId from get_partner.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        fundingId: { type: 'string' },
        amountRm: { type: 'number' },
        occurredAt: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['fundingId', 'amountRm'],
    },
    run: async ({ fastify }, input) => {
      const row: any = await createRepayment(fastify, {
        fundingId: input.fundingId,
        amount: toCents(input.amountRm),
        occurredAt: parseDate(input.occurredAt ?? 'today', false),
        note: input.note ?? null,
      });
      return { repaymentId: row.id, amount: money(row.amount), fundingId: input.fundingId };
    },
  },

  {
    name: 'record_payout',
    description:
      'A one-off profit payment to one person from Ascend\'s bank, outside a share-out ("on account"). Normally use share_out_profit, which pays everyone their part of specific orders and marks them shared. NOT a repayment of a loan — use record_repayment for that.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        partnerRef: { type: 'string' },
        amountRm: { type: 'number' },
        occurredAt: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['partnerRef', 'amountRm'],
    },
    summarize: async ({ prisma }, input) => {
      const p = await resolvePartner(prisma, input.partnerRef);
      return `pay ${p.name} ${rm(toCents(input.amountRm))} from Ascend's bank, on account (not tied to orders)`;
    },
    run: async ({ fastify, prisma }, input) => {
      const p = await resolvePartner(prisma, input.partnerRef);
      const row: any = await createPayout(fastify, {
        partnerId: p.id,
        amount: toCents(input.amountRm),
        occurredAt: parseDate(input.occurredAt ?? 'today', false),
        note: input.note ?? null,
      });
      return { payoutId: row.id, partner: p.name, amount: money(row.amount) };
    },
  },

  {
    name: 'delete_finance_record',
    description: 'Remove a funding, repayment or payout record that was entered by mistake.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['funding', 'repayment', 'payout'] },
        id: { type: 'string' },
      },
      required: ['kind', 'id'],
    },
    summarize: async ({ prisma }, input) => {
      const table: any = { funding: prisma.partnerFunding, repayment: prisma.partnerRepayment, payout: prisma.profitPayout };
      const row = await table[input.kind].findUnique({ where: { id: input.id } });
      if (!row) throw new Error(`No ${input.kind} with id ${input.id}.`);
      return `delete the ${rm(row.amount)} ${input.kind} record dated ${mytDateKey(new Date(row.occurredAt))}`;
    },
    run: async ({ fastify }, input) => {
      if (input.kind === 'funding') await deleteFunding(fastify, input.id);
      else if (input.kind === 'repayment') await deleteRepayment(fastify, input.id);
      else await deletePayout(fastify, input.id);
      return { deleted: true, kind: input.kind, id: input.id };
    },
  },
];

/** Every ready order, or the named ones (each must be ready). */
async function shareOutIds(ctx: any, refs: string[] | undefined): Promise<string[]> {
  if (!refs?.length) {
    const q: any = await getShareOut(ctx.fastify);
    if (!q.ready.length) throw new Error('Nothing is ready to share — orders join once paid, delivered and costed.');
    return q.ready.map((o: any) => o.id);
  }
  const ids: string[] = [];
  for (const ref of refs) ids.push((await resolveOrder(ctx.prisma, String(ref).trim())).id);
  return [...new Set(ids)];
}

async function resolveRuleShares(prisma: any, shares: { name: string; percent: number }[]) {
  const partners = await prisma.partner.findMany({ where: { active: true } });
  const parts = (shares ?? []).map((s) => {
    const n = String(s.name).trim().toLowerCase();
    const p =
      partners.find((x: any) => x.name.toLowerCase() === n) ??
      (/^(ascend|company|bank|ascend'?s bank|syarikat)$/.test(n) ? partners.find((x: any) => x.kind === 'COMPANY') : undefined);
    if (!p) throw new Error(`No active partner called "${s.name}". Known: ${partners.map((x: any) => x.name).join(', ')}.`);
    return { partnerId: p.id, name: p.name, shareBps: Math.round(s.percent * 100) };
  });
  const total = parts.reduce((a: number, p: { shareBps: number }) => a + p.shareBps, 0);
  if (total !== 10_000) throw new Error(`Shares total ${(total / 100).toFixed(2)}%, not 100%.`);
  return parts;
}
