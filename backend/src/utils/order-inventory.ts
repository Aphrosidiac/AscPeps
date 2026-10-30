import type { FastifyInstance } from 'fastify';

/**
 * Restore the stock + discount usage an order reserved at creation — exactly
 * once, atomically. Multiple code paths can want to "release" an order (gateway
 * FAILED callback, reconcile sweep, admin CANCEL, admin REFUNDED). Without a
 * guard they double-restore: stock incremented twice, usedCount driven negative.
 *
 * The `stockRestored` flag is claimed inside the same transaction as the restore,
 * so concurrent callers race on the flag and only the winner restores. The
 * discount decrement is floored (usedCount > 0) so it can never go negative.
 *
 * Returns true if THIS call performed the restore, false if it was already done.
 */
export async function restoreOrderInventory(
  fastify: FastifyInstance,
  orderId: string
): Promise<boolean> {
  return fastify.prisma.$transaction(async (tx) => {
    // Atomically claim the restore — only one caller can flip false -> true.
    const claim = await tx.order.updateMany({
      where: { id: orderId, stockRestored: false },
      data: { stockRestored: true },
    });
    if (claim.count === 0) return false; // already restored by someone else

    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) return false;

    // Only what the order took: pre-ordered units (and every Group Buy unit)
    // never came out of stock, so giving them back would invent stock.
    for (const item of order.items) {
      const taken = item.quantity - item.preorderQty;
      if (taken <= 0) continue;
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { increment: taken } },
      });
    }
    if (order.discountCodeId) {
      await tx.discountCode.updateMany({
        where: { id: order.discountCodeId, usedCount: { gt: 0 } },
        data: { usedCount: { decrement: 1 } },
      });
    }
    return true;
  });
}
