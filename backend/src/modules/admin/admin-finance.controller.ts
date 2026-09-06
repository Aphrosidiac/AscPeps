import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { computeFinance, type FinanceOrder } from '../../utils/finance.js';

// Cents. Capped well above any plausible figure so a mistyped amount can't
// overflow the INTEGER column.
const moneyCents = z.number().int().min(1).max(1_000_000_000);

const partnersSchema = z.object({
  partners: z
    .array(
      z.object({
        // Absent for a partner being created in this same save.
        id: z.string().optional(),
        name: z.string().trim().min(1, 'Name is required').max(60),
        active: z.boolean(),
        notes: z.string().trim().max(500).nullable().optional(),
      })
    )
    .max(20),
});

const expenseSchema = z.object({
  occurredAt: z.coerce.date(),
  category: z.string().trim().min(1, 'Category is required').max(60),
  description: z.string().trim().min(1, 'Description is required').max(300),
  amount: moneyCents,
  // Whether this is consumed now or bought stock. Optional so an older client
  // keeps writing operating spending, which is what it always meant.
  kind: z.enum(['OPERATING', 'INVENTORY']).optional(),
  paidByPartnerId: z.string().nullable().optional(),
  // Only meaningful alongside paidByPartnerId — decides whether fronting this
  // cost created a debt to that partner or was pure investment.
  paidByFundingType: z.enum(['CONTRIBUTION', 'ADVANCE']).nullable().optional(),
});

// Partial by construction — every field optional, and `paidByPartnerId` absent
// entirely. See updateExpense for why who-paid is not editable.
const expenseUpdateSchema = expenseSchema
  .omit({ paidByPartnerId: true, paidByFundingType: true })
  .partial()
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to update' });

const fundingSchema = z.object({
  partnerId: z.string().min(1),
  type: z.enum(['CONTRIBUTION', 'ADVANCE']),
  amount: moneyCents,
  occurredAt: z.coerce.date(),
  description: z.string().trim().min(1, 'Description is required').max(300),
});

const repaymentSchema = z.object({
  fundingId: z.string().min(1),
  amount: moneyCents,
  occurredAt: z.coerce.date(),
  note: z.string().trim().max(300).nullable().optional(),
});

const payoutSchema = z.object({
  partnerId: z.string().min(1),
  amount: moneyCents,
  occurredAt: z.coerce.date(),
  note: z.string().trim().max(300).nullable().optional(),
});

/** Everything the balance maths needs, in one place so nothing drifts. */
async function loadFinanceInput(fastify: FastifyInstance) {
  const [partners, orders, expenses, funding, payouts] = await Promise.all([
    fastify.prisma.partner.findMany(),
    // Orders the money actually arrived on — matching the analytics endpoint
    // exactly, so the two never disagree.
    //
    // REFUNDED is included deliberately. Filtering to PAID alone did not just
    // remove the refunded sale, it removed the courier, the packaging and the
    // gateway fee we had already paid on it: a refund made the books LOOK
    // better than reality. Its revenue is now reversed by refundedAmount and
    // the costs stand — see costOrder.
    fastify.prisma.order.findMany({
      where: { deletedAt: null, paymentStatus: { in: ['PAID', 'REFUNDED'] } },
      select: {
        id: true,
        total: true,
        gatewayFee: true,
        refundedAmount: true,
        stockRestored: true,
        items: { select: { quantity: true, unitCost: true } },
        extraCosts: { select: { amount: true } },
        profitShares: { select: { partnerId: true, shareBps: true, capitalAmount: true } },
      },
    }),
    fastify.prisma.companyExpense.findMany({ select: { id: true, amount: true, kind: true } }),
    fastify.prisma.partnerFunding.findMany({
      select: { id: true, partnerId: true, type: true, amount: true, repayments: { select: { amount: true } } },
    }),
    fastify.prisma.profitPayout.findMany({ select: { partnerId: true, amount: true } }),
  ]);

  return { partners, orders: orders as FinanceOrder[], expenses, funding, payouts };
}

type ActivityKind = 'EXPENSE' | 'CONTRIBUTION' | 'ADVANCE' | 'REPAYMENT' | 'PAYOUT';

interface FinanceActivity {
  id: string;
  kind: ActivityKind;
  occurredAt: Date;
  description: string;
  partnerId: string | null;
  partnerName: string | null;
  amount: number;
  /** Which way the money moved relative to the company. */
  direction: 'IN' | 'OUT';
  /** EXPENSE only. */
  category?: string;
  /** EXPENSE only — set when a partner fronted it, saying on what terms. */
  fundedAs?: 'CONTRIBUTION' | 'ADVANCE' | null;
}

/**
 * One feed covering every way money moves, not just company expenses — an
 * advance or a payout is just as much "something happened" as buying ads, and
 * a feed that silently omitted them made recorded money look like it vanished.
 */
async function loadRecentActivity(fastify: FastifyInstance, take = 8): Promise<FinanceActivity[]> {
  const [expenses, funding, repayments, payouts] = await Promise.all([
    fastify.prisma.companyExpense.findMany({
      orderBy: { occurredAt: 'desc' },
      take,
      include: { paidBy: { select: { id: true, name: true } }, funding: { select: { type: true } } },
    }),
    fastify.prisma.partnerFunding.findMany({
      // Funding attached to an expense is skipped: the expense row already
      // reports it ("paid by X · owed back"), and listing both reads as the
      // money having moved twice.
      where: { expenseId: null },
      orderBy: { occurredAt: 'desc' },
      take,
      include: { partner: { select: { id: true, name: true } } },
    }),
    fastify.prisma.partnerRepayment.findMany({
      orderBy: { occurredAt: 'desc' },
      take,
      include: { funding: { include: { partner: { select: { id: true, name: true } } } } },
    }),
    fastify.prisma.profitPayout.findMany({
      orderBy: { occurredAt: 'desc' },
      take,
      include: { partner: { select: { id: true, name: true } } },
    }),
  ]);

  const activity: FinanceActivity[] = [
    ...expenses.map((e) => ({
      id: e.id,
      kind: 'EXPENSE' as const,
      occurredAt: e.occurredAt,
      description: e.description,
      partnerId: e.paidBy?.id ?? null,
      partnerName: e.paidBy?.name ?? null,
      amount: e.amount,
      direction: 'OUT' as const,
      category: e.category,
      fundedAs: e.funding?.type ?? null,
    })),
    ...funding.map((f) => ({
      id: f.id,
      kind: f.type as 'CONTRIBUTION' | 'ADVANCE',
      occurredAt: f.occurredAt,
      description: f.description,
      partnerId: f.partner.id,
      partnerName: f.partner.name,
      amount: f.amount,
      direction: 'IN' as const,
    })),
    ...repayments.map((r) => ({
      id: r.id,
      kind: 'REPAYMENT' as const,
      occurredAt: r.occurredAt,
      description: r.note || `Repaid: ${r.funding.description}`,
      partnerId: r.funding.partner.id,
      partnerName: r.funding.partner.name,
      amount: r.amount,
      direction: 'OUT' as const,
    })),
    ...payouts.map((p) => ({
      id: p.id,
      kind: 'PAYOUT' as const,
      occurredAt: p.occurredAt,
      description: p.note || 'Profit payout',
      partnerId: p.partner.id,
      partnerName: p.partner.name,
      amount: p.amount,
      direction: 'OUT' as const,
    })),
  ];

  return activity
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, take);
}

export async function getFinanceOverview(fastify: FastifyInstance) {
  const input = await loadFinanceInput(fastify);
  const summary = computeFinance(input);

  // Which partners can be removed outright. Computed here rather than inferred
  // in the UI from "all their numbers are zero": a partner can legitimately
  // show zeroes while still being attached to an order split, and deleting
  // that would take the split's name with it.
  const counts = await fastify.prisma.partner.findMany({
    select: {
      id: true,
      _count: { select: { profitShares: true, funding: true, payouts: true, expensesPaid: true } },
    },
  });
  const removable = new Set(
    counts
      .filter((c) => !c._count.profitShares && !c._count.funding && !c._count.payouts && !c._count.expensesPaid)
      .map((c) => c.id)
  );

  return {
    ...summary,
    partners: summary.partners.map((p) => ({ ...p, removable: removable.has(p.partnerId) })),
    recentActivity: await loadRecentActivity(fastify),
  };
}

/** One partner's full history — the "show me why" behind their balance. */
export async function getPartnerDetail(fastify: FastifyInstance, id: string) {
  const partner = await fastify.prisma.partner.findUnique({ where: { id } });
  if (!partner) throw { statusCode: 404, message: 'Partner not found' };

  const input = await loadFinanceInput(fastify);
  const summary = computeFinance(input);
  const balance = summary.partners.find((p) => p.partnerId === id);

  const [funding, payouts, shares] = await Promise.all([
    fastify.prisma.partnerFunding.findMany({
      where: { partnerId: id },
      orderBy: { occurredAt: 'desc' },
      include: {
        repayments: { orderBy: { occurredAt: 'desc' } },
        expense: { select: { id: true, description: true, category: true } },
      },
    }),
    fastify.prisma.profitPayout.findMany({ where: { partnerId: id }, orderBy: { occurredAt: 'desc' } }),
    fastify.prisma.orderProfitShare.findMany({
      where: { partnerId: id },
      include: {
        order: {
          select: {
            id: true, orderNumber: true, createdAt: true, total: true, deletedAt: true, paymentStatus: true,
            gatewayFee: true, refundedAmount: true, stockRestored: true,
            items: { select: { quantity: true, unitCost: true } },
            extraCosts: { select: { amount: true } },
            profitShares: { select: { partnerId: true, shareBps: true, capitalAmount: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // Re-derive this partner's cut per order so the list adds up to `earned`
  // exactly — including the rounding remainder, which a naive
  // profit × shareBps ÷ 10000 per row would lose.
  const earnings = shares
    // Same order set as loadFinanceInput, for the same reason: a refunded order
    // still belongs in someone's history — it just earned less, or nothing.
    .filter(
      (s) =>
        s.order.deletedAt === null &&
        (s.order.paymentStatus === 'PAID' || s.order.paymentStatus === 'REFUNDED')
    )
    .map((s) => {
      const contributing = computeFinance({
        partners: input.partners,
        orders: [s.order as unknown as FinanceOrder],
        expenses: [],
        funding: [],
        payouts: [],
      });
      const mine = contributing.partners.find((p) => p.partnerId === id);
      return {
        orderId: s.order.id,
        orderNumber: s.order.orderNumber,
        occurredAt: s.order.createdAt,
        shareBps: s.shareBps,
        orderProfit: contributing.grossOrderProfit,
        amount: mine?.earned ?? 0,
        costed: contributing.costedOrders > 0,
        refunded: s.order.refundedAmount > 0,
      };
    });

  return { partner, balance, earnings, funding, payouts };
}

export async function saveFinancePartners(fastify: FastifyInstance, body: unknown) {
  const { partners } = partnersSchema.parse(body);

  const names = partners.map((p) => p.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    throw { statusCode: 400, message: 'Each partner name can only appear once.' };
  }

  await fastify.prisma.$transaction(
    partners.map((p) =>
      p.id
        ? fastify.prisma.partner.update({
            where: { id: p.id },
            data: { name: p.name, active: p.active, notes: p.notes ?? null },
          })
        : fastify.prisma.partner.create({
            data: { name: p.name, active: p.active, notes: p.notes ?? null },
          })
    )
  );

  return fastify.prisma.partner.findMany({ orderBy: { name: 'asc' } });
}

export async function listExpenses(fastify: FastifyInstance, query: Record<string, string>) {
  const where: Record<string, unknown> = {};
  if (query.category) where.category = query.category;

  const [expenses, categories] = await Promise.all([
    fastify.prisma.companyExpense.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      include: {
        paidBy: { select: { id: true, name: true } },
        funding: { select: { id: true, type: true, repayments: { select: { amount: true } } } },
        // Counted here rather than by fetching every document and tallying them
        // in the browser: that tally was capped by the documents page size, so
        // past it a row would quietly report fewer receipts than it has.
        _count: { select: { documents: true } },
      },
    }),
    // Powers the "categories already in use" suggestions — the thing that keeps
    // free-text categories from fragmenting into Marketing/marketing/Ads.
    fastify.prisma.companyExpense.findMany({ distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } }),
  ]);

  return { expenses, categories: categories.map((c) => c.category) };
}

/**
 * Creating an expense can create a second record: if a partner fronted the
 * cash, that's simultaneously a company cost and either a debt to them
 * (ADVANCE) or capital they've put in (CONTRIBUTION). Both are written in one
 * transaction so an expense can never exist with its funding half missing.
 */
export async function createExpense(fastify: FastifyInstance, body: unknown) {
  const data = expenseSchema.parse(body);

  if (data.paidByPartnerId && !data.paidByFundingType) {
    throw { statusCode: 400, message: 'Say whether the partner who paid gets this back.' };
  }

  const { paidByFundingType, ...expenseData } = data;

  return fastify.prisma.$transaction(async (tx) => {
    const expense = await tx.companyExpense.create({ data: expenseData });

    if (data.paidByPartnerId && paidByFundingType) {
      await tx.partnerFunding.create({
        data: {
          partnerId: data.paidByPartnerId,
          type: paidByFundingType,
          amount: data.amount,
          occurredAt: data.occurredAt,
          description: `Paid for: ${data.description}`,
          expenseId: expense.id,
        },
      });
    }

    return expense;
  });
}

/**
 * Edit an expense in place.
 *
 * This exists because the OPERATING/INVENTORY split is worthless without it:
 * every expense recorded before the split defaulted to OPERATING, and the stock
 * purchases among them are exactly the rows that were being double-counted.
 * Without an edit the only way to reclassify one is delete-and-recreate, which
 * destroys the funding row linked to it and, with it, an advance the company
 * still owes someone.
 *
 * `paidByPartnerId` is deliberately NOT editable here. Changing who fronted the
 * cash means rewriting or deleting a PartnerFunding row that may already have
 * repayments recorded against it, and quietly discarding a repayment history is
 * a worse outcome than making someone re-enter the expense.
 */
export async function updateExpense(fastify: FastifyInstance, id: string, body: unknown) {
  const data = expenseUpdateSchema.parse(body);

  const existing = await fastify.prisma.companyExpense.findUnique({
    where: { id },
    include: { funding: { select: { id: true, repayments: { select: { amount: true } } } } },
  });
  if (!existing) throw { statusCode: 404, message: 'Expense not found' };

  // The linked funding row is the same money seen from the partner's side, so
  // the two amounts must move together or the company would owe a figure that
  // no longer matches what was actually spent.
  const funding = existing.funding;
  if (data.amount !== undefined && funding) {
    const repaid = funding.repayments.reduce((sum, r) => sum + r.amount, 0);
    if (data.amount < repaid) {
      throw {
        statusCode: 400,
        message: `Already repaid RM${(repaid / 100).toFixed(2)} against this — the amount cannot drop below that.`,
      };
    }
  }

  return fastify.prisma.$transaction(async (tx) => {
    const expense = await tx.companyExpense.update({ where: { id }, data });

    if (funding && (data.amount !== undefined || data.occurredAt !== undefined || data.description !== undefined)) {
      await tx.partnerFunding.update({
        where: { id: funding.id },
        data: {
          ...(data.amount !== undefined ? { amount: data.amount } : {}),
          ...(data.occurredAt !== undefined ? { occurredAt: data.occurredAt } : {}),
          ...(data.description !== undefined ? { description: `Paid for: ${data.description}` } : {}),
        },
      });
    }

    return expense;
  });
}

export async function deleteExpense(fastify: FastifyInstance, id: string) {
  const expense = await fastify.prisma.companyExpense.findUnique({ where: { id } });
  if (!expense) throw { statusCode: 404, message: 'Expense not found' };
  // Its funding row cascades; any repayments against that funding cascade too.
  await fastify.prisma.companyExpense.delete({ where: { id } });
  return { success: true };
}

export async function createFunding(fastify: FastifyInstance, body: unknown) {
  const data = fundingSchema.parse(body);
  const partner = await fastify.prisma.partner.findUnique({ where: { id: data.partnerId } });
  if (!partner) throw { statusCode: 404, message: 'Partner not found' };
  return fastify.prisma.partnerFunding.create({ data });
}

export async function deleteFunding(fastify: FastifyInstance, id: string) {
  const funding = await fastify.prisma.partnerFunding.findUnique({ where: { id } });
  if (!funding) throw { statusCode: 404, message: 'Record not found' };
  if (funding.expenseId) {
    throw {
      statusCode: 400,
      message: 'This came from a company expense — delete the expense instead.',
    };
  }
  await fastify.prisma.partnerFunding.delete({ where: { id } });
  return { success: true };
}

export async function createRepayment(fastify: FastifyInstance, body: unknown) {
  const data = repaymentSchema.parse(body);

  const funding = await fastify.prisma.partnerFunding.findUnique({
    where: { id: data.fundingId },
    include: { repayments: { select: { amount: true } } },
  });
  if (!funding) throw { statusCode: 404, message: 'Advance not found' };
  if (funding.type !== 'ADVANCE') {
    throw { statusCode: 400, message: 'Only an advance can be repaid — a contribution is not owed back.' };
  }

  const outstanding = funding.amount - funding.repayments.reduce((sum, r) => sum + r.amount, 0);
  if (data.amount > outstanding) {
    throw {
      statusCode: 400,
      message: `That's more than is outstanding on this advance (RM${(outstanding / 100).toFixed(2)} left).`,
    };
  }

  return fastify.prisma.partnerRepayment.create({ data });
}

export async function deleteRepayment(fastify: FastifyInstance, id: string) {
  const repayment = await fastify.prisma.partnerRepayment.findUnique({ where: { id } });
  if (!repayment) throw { statusCode: 404, message: 'Repayment not found' };
  await fastify.prisma.partnerRepayment.delete({ where: { id } });
  return { success: true };
}

export async function createPayout(fastify: FastifyInstance, body: unknown) {
  const data = payoutSchema.parse(body);
  const partner = await fastify.prisma.partner.findUnique({ where: { id: data.partnerId } });
  if (!partner) throw { statusCode: 404, message: 'Partner not found' };
  return fastify.prisma.profitPayout.create({ data });
}

export async function deletePayout(fastify: FastifyInstance, id: string) {
  const payout = await fastify.prisma.profitPayout.findUnique({ where: { id } });
  if (!payout) throw { statusCode: 404, message: 'Payout not found' };
  await fastify.prisma.profitPayout.delete({ where: { id } });
  return { success: true };
}

/**
 * Delete a partner that nothing references.
 *
 * Partners are created implicitly: typing a name into an order's Profit Sharing
 * split upserts one. That is the right behaviour — you should not have to
 * register someone before splitting an order with them — but it means a typo,
 * or a split that was written and then removed, leaves a partner behind
 * forever. The Finance page showed four of those, all zeroes, with no way to
 * clear them.
 *
 * Refused when anything still points at the partner, and the refusal says what.
 * Deactivating instead would be wrong here: `active` already means "not
 * currently working with us", which is a real state a partner with history can
 * be in. A typo has no history and should leave no trace.
 */
export async function deletePartner(fastify: FastifyInstance, id: string) {
  const partner = await fastify.prisma.partner.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      _count: {
        select: { profitShares: true, funding: true, payouts: true, expensesPaid: true },
      },
    },
  });
  if (!partner) throw { statusCode: 404, message: 'Partner not found' };

  const { profitShares, funding, payouts, expensesPaid } = partner._count;
  const blocking = [
    profitShares && `${profitShares} order split${profitShares === 1 ? '' : 's'}`,
    funding && `${funding} funding record${funding === 1 ? '' : 's'}`,
    payouts && `${payouts} payout${payouts === 1 ? '' : 's'}`,
    expensesPaid && `${expensesPaid} expense${expensesPaid === 1 ? '' : 's'} they fronted`,
  ].filter(Boolean) as string[];

  if (blocking.length) {
    throw {
      statusCode: 400,
      message: `${partner.name} still has ${blocking.join(', ')}. Remove those first, or leave the partner marked inactive.`,
    };
  }

  await fastify.prisma.partner.delete({ where: { id } });
  return { deleted: true, name: partner.name };
}
