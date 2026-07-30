import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { computeFinance, type FinanceOrder } from '../../utils/finance.js';

// Cents. Capped well above any plausible figure so a mistyped amount can't
// overflow the INTEGER column.
const moneyCents = z.number().int().min(1).max(1_000_000_000);
const bps = z.number().int().min(0).max(10_000);

const partnersSchema = z.object({
  partners: z
    .array(
      z.object({
        // Absent for a partner being created in this same save.
        id: z.string().optional(),
        name: z.string().trim().min(1, 'Name is required').max(60),
        ownershipBps: bps,
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
  allocation: z.enum(['OWNERSHIP', 'SINGLE_PARTNER', 'UNALLOCATED']),
  chargedToPartnerId: z.string().nullable().optional(),
  paidByPartnerId: z.string().nullable().optional(),
  // Only meaningful alongside paidByPartnerId — decides whether fronting this
  // cost created a debt to that partner or was pure investment.
  paidByFundingType: z.enum(['CONTRIBUTION', 'ADVANCE']).nullable().optional(),
  receiptUrl: z.string().trim().max(500).nullable().optional(),
});

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
    // Only PAID, non-deleted orders can have produced real profit — matching
    // the analytics endpoint exactly, so the two never disagree.
    fastify.prisma.order.findMany({
      where: { deletedAt: null, paymentStatus: 'PAID' },
      select: {
        id: true,
        total: true,
        items: { select: { quantity: true, unitCost: true } },
        extraCosts: { select: { amount: true } },
        profitShares: { select: { partnerId: true, shareBps: true } },
      },
    }),
    fastify.prisma.companyExpense.findMany({
      select: { id: true, amount: true, allocation: true, chargedToPartnerId: true },
    }),
    fastify.prisma.partnerFunding.findMany({
      select: { id: true, partnerId: true, type: true, amount: true, repayments: { select: { amount: true } } },
    }),
    fastify.prisma.profitPayout.findMany({ select: { partnerId: true, amount: true } }),
  ]);

  return { partners, orders: orders as FinanceOrder[], expenses, funding, payouts };
}

export async function getFinanceOverview(fastify: FastifyInstance) {
  const input = await loadFinanceInput(fastify);
  const summary = computeFinance(input);

  const ownershipBps = input.partners
    .filter((p) => p.active)
    .reduce((sum, p) => sum + p.ownershipBps, 0);

  return {
    ...summary,
    // Surfaced so the UI can warn rather than silently mis-allocating: if this
    // isn't 10000, expenses are still fully distributed (weights are
    // normalised) but not in the proportions anyone intended.
    ownershipBps,
    recentExpenses: await fastify.prisma.companyExpense.findMany({
      orderBy: { occurredAt: 'desc' },
      take: 5,
      include: {
        paidBy: { select: { id: true, name: true } },
        chargedTo: { select: { id: true, name: true } },
      },
    }),
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
            items: { select: { quantity: true, unitCost: true } },
            extraCosts: { select: { amount: true } },
            profitShares: { select: { partnerId: true, shareBps: true } },
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
    .filter((s) => s.order.deletedAt === null && s.order.paymentStatus === 'PAID')
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
      };
    });

  return { partner, balance, earnings, funding, payouts };
}

/**
 * Partners are saved as a set: ownership only means anything relative to the
 * others, so validating one at a time would let the total drift past 100%
 * between saves.
 */
export async function saveFinancePartners(fastify: FastifyInstance, body: unknown) {
  const { partners } = partnersSchema.parse(body);

  const activeTotal = partners.filter((p) => p.active).reduce((sum, p) => sum + p.ownershipBps, 0);
  if (partners.some((p) => p.active) && activeTotal !== 10_000) {
    throw {
      statusCode: 400,
      message: `Ownership across active partners must total exactly 100% — currently ${(activeTotal / 100).toFixed(2)}%.`,
    };
  }

  const names = partners.map((p) => p.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) {
    throw { statusCode: 400, message: 'Each partner name can only appear once.' };
  }

  await fastify.prisma.$transaction(
    partners.map((p) =>
      p.id
        ? fastify.prisma.partner.update({
            where: { id: p.id },
            data: { name: p.name, ownershipBps: p.ownershipBps, active: p.active, notes: p.notes ?? null },
          })
        : fastify.prisma.partner.create({
            data: { name: p.name, ownershipBps: p.ownershipBps, active: p.active, notes: p.notes ?? null },
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
        chargedTo: { select: { id: true, name: true } },
        funding: { select: { id: true, type: true, repayments: { select: { amount: true } } } },
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

  if (data.allocation === 'SINGLE_PARTNER' && !data.chargedToPartnerId) {
    throw { statusCode: 400, message: 'Choose which partner this expense is charged to.' };
  }
  if (data.paidByPartnerId && !data.paidByFundingType) {
    throw { statusCode: 400, message: 'Say whether the partner who paid gets this back.' };
  }

  const { paidByFundingType, ...expenseData } = data;

  return fastify.prisma.$transaction(async (tx) => {
    const expense = await tx.companyExpense.create({
      data: {
        ...expenseData,
        chargedToPartnerId: data.allocation === 'SINGLE_PARTNER' ? data.chargedToPartnerId : null,
      },
    });

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
