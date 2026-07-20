import type { Prisma } from '@prisma/client';

export async function generateOrderNumber(tx: Prisma.TransactionClient): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `ASC${yy}${mm}`;

  // Max is derived numerically, not via orderBy on the string column — lexical
  // ordering breaks once sequences have mixed widths ("999" > "1000"). Legacy
  // 3-digit numbers coexist with the current 4-digit padding, so this must
  // parse every suffix for the month.
  const existing = await tx.order.findMany({
    where: { orderNumber: { startsWith: prefix } },
    select: { orderNumber: true },
  });

  let next = 1;
  for (const { orderNumber } of existing) {
    const seq = parseInt(orderNumber.split('/')[1], 10);
    if (Number.isFinite(seq) && seq >= next) next = seq + 1;
  }

  // No lock: two concurrent orders can still compute the same number. The
  // unique constraint on orderNumber catches that, and createOrder retries
  // generation on a P2002 for this field.
  return `${prefix}/${String(next).padStart(4, '0')}`;
}
