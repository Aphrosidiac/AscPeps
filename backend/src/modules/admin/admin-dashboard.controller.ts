import type { FastifyInstance } from 'fastify';
import { getVariantDisplayName } from '../../utils/product-addons.js';
import { costOrder, allocate } from '../../utils/profit.js';

export async function getDashboardStats(fastify: FastifyInstance) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    todayOrders,
    todayRevenue,
    totalProducts,
    lowStockProducts,
    ordersByStatus,
    recentOrders,
    failedEmails,
  ] = await Promise.all([
    fastify.prisma.order.count({ where: { createdAt: { gte: today }, deletedAt: null } }),

    fastify.prisma.order.aggregate({
      where: { createdAt: { gte: today }, paymentStatus: 'PAID', deletedAt: null },
      _sum: { total: true },
    }),

    fastify.prisma.product.count({ where: { active: true } }),

    fastify.prisma.productVariant.findMany({
      where: { active: true, stock: { lt: 5 }, product: { active: true } },
      select: { id: true, code: true, size: true, stock: true, product: { select: { name: true } } },
      orderBy: { stock: 'asc' },
    }),

    fastify.prisma.order.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: true,
    }),

    fastify.prisma.order.findMany({
      where: { deletedAt: null },
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { variant: { select: { code: true, size: true, product: { select: { name: true } } } } } } },
    }),

    fastify.prisma.emailOutbox.count({ where: { status: 'FAILED' } }),
  ]);

  return {
    todayOrders,
    todayRevenue: todayRevenue._sum.total || 0,
    totalProducts,
    lowStockProducts: lowStockProducts.map((v) => ({
      id: v.id, code: v.code, name: getVariantDisplayName(v.product, v), stock: v.stock,
    })),
    ordersByStatus: Object.fromEntries(ordersByStatus.map((o) => [o.status, o._count])),
    recentOrders,
    failedEmails,
  };
}

// The business, its customers and every timestamp shown in the UI are Malaysian
// time. `toISOString().slice(0, 10)` buckets by the UTC date instead, which
// silently pushes every order placed between 00:00 and 08:00 MYT onto the
// previous day's bar — a third of every day landing in the wrong column while
// the orders list shows the correct date. Pinned rather than read from the host
// so the numbers don't change if the VPS timezone ever does.
const REPORTING_TIME_ZONE = 'Asia/Kuala_Lumpur';

// en-CA gives YYYY-MM-DD, which is what the day keys need.
const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORTING_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const localDayKey = (date: Date): string => dayKeyFormatter.format(date);

interface DailyPoint {
  date: string;
  revenue: number;
  orders: number;
  /** Revenue from the paid orders on this day that are fully costed. */
  costedRevenue: number;
  cost: number;
  profit: number;
}

export async function getAnalytics(fastify: FastifyInstance, query: { days?: string }) {
  const parsedDays = parseInt(query.days ?? '30', 10);
  const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), 365) : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const orders = await fastify.prisma.order.findMany({
    where: { createdAt: { gte: since }, deletedAt: null },
    select: {
      id: true,
      total: true,
      subtotal: true,
      discountAmount: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      paymentGateway: true,
      createdAt: true,
      items: {
        select: {
          variantId: true, quantity: true, unitPrice: true, unitCost: true,
          variant: { select: { code: true, size: true, product: { select: { name: true, categoryId: true } } } },
        },
      },
      extraCosts: { select: { amount: true } },
      profitShares: { select: { name: true, shareBps: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const dailyRevenue: Record<string, DailyPoint> = {};
  const endOfRange = new Date();
  for (let d = new Date(since); d <= endOfRange; d.setDate(d.getDate() + 1)) {
    const key = localDayKey(d);
    dailyRevenue[key] = { date: key, revenue: 0, orders: 0, costedRevenue: 0, cost: 0, profit: 0 };
  }

  const productSales: Record<string, { name: string; code: string; quantity: number; revenue: number }> = {};
  let totalRevenue = 0;
  let totalOrders = 0;
  let paidOrders = 0;
  let failedOrders = 0;
  const paymentMethodCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};

  // Profit is measured only over paid orders that are FULLY costed, and
  // reported against that subset's own revenue (costedRevenue) rather than
  // against all revenue. Dividing a fully-costed subset's profit by every
  // paid order's revenue would understate margin badly while orders are still
  // being costed — and quietly, which is worse. `uncostedOrders` is returned
  // so the UI can say how much of the period is actually covered.
  let costedRevenue = 0;
  let costedOrders = 0;
  let uncostedOrders = 0;
  let totalItemCost = 0;
  let totalExtraCost = 0;
  const profitByPerson: Record<string, number> = {};

  for (const order of orders) {
    const dayKey = localDayKey(order.createdAt);
    if (dailyRevenue[dayKey]) {
      dailyRevenue[dayKey].orders++;
      if (order.paymentStatus === 'PAID') {
        dailyRevenue[dayKey].revenue += order.total;
      }
    }

    totalOrders++;
    if (order.paymentStatus === 'PAID') {
      paidOrders++;
      totalRevenue += order.total;

      const costing = costOrder(order);
      if (costing.profit === null) {
        uncostedOrders++;
      } else {
        costedOrders++;
        costedRevenue += order.total;
        totalItemCost += costing.itemCost;
        totalExtraCost += costing.extraCost;

        if (dailyRevenue[dayKey]) {
          dailyRevenue[dayKey].costedRevenue += order.total;
          dailyRevenue[dayKey].cost += costing.itemCost + costing.extraCost;
          dailyRevenue[dayKey].profit += costing.profit;
        }

        // Allocated per order, then summed — so each order's split lands
        // exactly and the per-person column adds back up to net profit.
        const shares = order.profitShares;
        if (shares.length > 0) {
          const amounts = allocate(costing.profit, shares.map((s) => s.shareBps));
          shares.forEach((share, i) => {
            profitByPerson[share.name] = (profitByPerson[share.name] || 0) + amounts[i];
          });
        }
      }
    }
    if (order.paymentStatus === 'FAILED') failedOrders++;

    const method = order.paymentGateway || order.paymentMethod;
    paymentMethodCounts[method] = (paymentMethodCounts[method] || 0) + 1;
    statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;

    if (order.paymentStatus === 'PAID') {
      for (const item of order.items) {
        const key = item.variantId;
        if (!productSales[key]) {
          const name = getVariantDisplayName(item.variant.product, item.variant);
          productSales[key] = { name, code: item.variant.code, quantity: 0, revenue: 0 };
        }
        productSales[key].quantity += item.quantity;
        productSales[key].revenue += item.unitPrice * item.quantity;
      }
    }
  }

  const topProducts = Object.values(productSales)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  const conversionRate = totalOrders > 0 ? Math.round((paidOrders / totalOrders) * 10000) / 100 : 0;
  const avgOrderValue = paidOrders > 0 ? Math.round(totalRevenue / paidOrders) : 0;

  const totalCost = totalItemCost + totalExtraCost;
  const netProfit = costedRevenue - totalCost;
  // Against costedRevenue, not totalRevenue — see the note where these are summed.
  const profitMargin = costedRevenue > 0 ? Math.round((netProfit / costedRevenue) * 10000) / 100 : 0;

  const profitShare = Object.entries(profitByPerson)
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    period: { days, since: since.toISOString() },
    summary: {
      totalRevenue,
      totalOrders,
      paidOrders,
      failedOrders,
      conversionRate,
      avgOrderValue,
      totalItemCost,
      totalExtraCost,
      totalCost,
      netProfit,
      profitMargin,
      costedRevenue,
      costedOrders,
      uncostedOrders,
    },
    dailyRevenue: Object.values(dailyRevenue),
    topProducts,
    profitShare,
    paymentMethods: paymentMethodCounts,
    orderStatuses: statusCounts,
  };
}
