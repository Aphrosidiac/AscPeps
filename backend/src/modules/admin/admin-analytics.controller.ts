import type { FastifyInstance } from 'fastify';
import { computeAnalytics } from '../../utils/analytics-model.js';
import { ensureDefaultSplits } from '../../utils/split-rules.js';
import { syncAffiliateOrders } from '../../utils/affiliate.js';

/**
 * Loads the rows for the month-by-month Analytics page. The working-out lives
 * in utils/analytics-model.ts; the rolling getAnalytics stays for the
 * assistant's sales_analytics tool.
 */
export async function getMonthlyAnalytics(fastify: FastifyInstance, query: { from?: string; to?: string } = {}) {
  const prisma = fastify.prisma;
  const period = readPeriod(query);

  // Same sweep as Money and the month-end wrap: a paid order with no split gets
  // the default first, so the three pages read the same shares.
  await ensureDefaultSplits(prisma);
  await syncAffiliateOrders(prisma);

  const [orders, expenses, variants] = await Promise.all([
    prisma.order.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        customerName: true,
        phone: true,
        state: true,
        createdAt: true,
        paidAt: true,
        shippedAt: true,
        deliveredAt: true,
        total: true,
        discountAmount: true,
        refundedAmount: true,
        gatewayFee: true,
        affiliateCommission: true,
        stockRestored: true,
        status: true,
        paymentStatus: true,
        paymentMethod: true,
        paymentGateway: true,
        paymentFailureReason: true,
        isPreorder: true,
        groupBuyId: true,
        discountCode: { select: { code: true } },
        affiliate: { select: { fullName: true } },
        items: {
          select: {
            variantId: true,
            quantity: true,
            unitPrice: true,
            unitCost: true,
            parentItemId: true,
            variant: { select: { code: true, size: true, product: { select: { name: true, addOnOnly: true } } } },
          },
        },
        extraCosts: { select: { amount: true } },
        profitShares: { select: { name: true, shareBps: true, partnerId: true, partner: { select: { name: true, kind: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.companyExpense.findMany({ select: { occurredAt: true, category: true, amount: true, kind: true } }),
    prisma.productVariant.findMany({
      where: { active: true, product: { active: true } },
      select: {
        id: true,
        code: true,
        size: true,
        stock: true,
        product: { select: { name: true, addOnOnly: true } },
        supplierCosts: { select: { cost: true }, orderBy: { cost: 'asc' }, take: 1 },
      },
    }),
  ]);

  return computeAnalytics({
    orders,
    expenses,
    variants: variants.map(({ supplierCosts, ...v }) => ({ ...v, supplierCost: supplierCosts[0]?.cost ?? null })),
    now: new Date(),
    period,
  });
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A real span of Malaysian days, or none: a bad query falls back to the plain report. */
function readPeriod({ from, to }: { from?: string; to?: string }) {
  if (!from || !to || !DAY.test(from) || !DAY.test(to)) return undefined;
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return undefined;
  return from <= to ? { from, to } : { from: to, to: from };
}
