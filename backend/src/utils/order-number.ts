import type { PrismaClient } from '@prisma/client';

export async function generateOrderNumber(prisma: PrismaClient): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `ASC${yy}${mm}`;

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const count = await prisma.order.count({
    where: {
      createdAt: {
        gte: startOfMonth,
        lt: startOfNextMonth,
      },
    },
  });

  return `${prefix}/${String(count + 1).padStart(3, '0')}`;
}
