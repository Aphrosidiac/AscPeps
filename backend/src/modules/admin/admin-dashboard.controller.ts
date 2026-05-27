import type { FastifyInstance } from 'fastify';
import type { OrderStatus, PaymentStatus } from '@prisma/client';

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
  ] = await Promise.all([
    fastify.prisma.order.count({ where: { createdAt: { gte: today } } }),

    fastify.prisma.order.aggregate({
      where: { createdAt: { gte: today }, paymentStatus: 'PAID' },
      _sum: { total: true },
    }),

    fastify.prisma.product.count({ where: { active: true } }),

    fastify.prisma.product.findMany({
      where: { active: true, stock: { lt: 5 } },
      select: { id: true, code: true, name: true, stock: true },
      orderBy: { stock: 'asc' },
    }),

    fastify.prisma.order.groupBy({
      by: ['status'],
      _count: true,
    }),

    fastify.prisma.order.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { product: { select: { name: true, code: true } } } } },
    }),
  ]);

  return {
    todayOrders,
    todayRevenue: todayRevenue._sum.total || 0,
    totalProducts,
    lowStockProducts,
    ordersByStatus: Object.fromEntries(ordersByStatus.map((o) => [o.status, o._count])),
    recentOrders,
  };
}

export async function getAnalytics(fastify: FastifyInstance, query: { days?: string }) {
  const days = Math.min(parseInt(query.days || '30', 10), 365);
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const orders = await fastify.prisma.order.findMany({
    where: { createdAt: { gte: since } },
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
      items: { select: { productId: true, quantity: true, unitPrice: true, product: { select: { name: true, code: true, categoryId: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const dailyRevenue: Record<string, { date: string; revenue: number; orders: number }> = {};
  for (let d = new Date(since); d <= new Date(); d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    dailyRevenue[key] = { date: key, revenue: 0, orders: 0 };
  }

  const productSales: Record<string, { name: string; code: string; quantity: number; revenue: number }> = {};
  let totalRevenue = 0;
  let totalOrders = 0;
  let paidOrders = 0;
  let failedOrders = 0;
  const paymentMethodCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};

  for (const order of orders) {
    const dayKey = order.createdAt.toISOString().slice(0, 10);
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
    }
    if (order.paymentStatus === 'FAILED') failedOrders++;

    const method = order.paymentGateway || order.paymentMethod;
    paymentMethodCounts[method] = (paymentMethodCounts[method] || 0) + 1;
    statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;

    if (order.paymentStatus === 'PAID') {
      for (const item of order.items) {
        const key = item.productId;
        if (!productSales[key]) {
          productSales[key] = { name: item.product.name, code: item.product.code, quantity: 0, revenue: 0 };
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

  return {
    period: { days, since: since.toISOString() },
    summary: {
      totalRevenue,
      totalOrders,
      paidOrders,
      failedOrders,
      conversionRate,
      avgOrderValue,
    },
    dailyRevenue: Object.values(dailyRevenue),
    topProducts,
    paymentMethods: paymentMethodCounts,
    orderStatuses: statusCounts,
  };
}
