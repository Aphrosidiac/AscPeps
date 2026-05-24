import type { FastifyInstance } from 'fastify';

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
