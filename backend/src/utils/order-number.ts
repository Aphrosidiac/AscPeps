interface OrderNumberTx {
  order: {
    findFirst: (args: {
      where: Record<string, unknown>;
      orderBy: Record<string, string>;
      select: Record<string, boolean>;
    }) => Promise<{ orderNumber: string } | null>;
  };
}

export async function generateOrderNumber(tx: OrderNumberTx): Promise<string> {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `ASC${yy}${mm}`;

  const latest = await tx.order.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });

  let next = 1;
  if (latest) {
    const seq = parseInt(latest.orderNumber.split('/')[1], 10);
    if (Number.isFinite(seq)) next = seq + 1;
  }

  return `${prefix}/${String(next).padStart(3, '0')}`;
}
