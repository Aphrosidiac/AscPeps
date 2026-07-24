import type { Prisma, EmailType } from '@prisma/client';

/**
 * Queue a transactional email for an order. Call inside the SAME transaction
 * as the state change it announces, so a rollback discards the email too.
 *
 * No-op when the order has no email (it's optional at checkout), and
 * skipDuplicates makes a double-fire (payment callback + redirect verify +
 * reconcile sweep can all confirm the same order) a silent no-op against the
 * (orderId, type) unique key instead of a P2002.
 */
export async function enqueueEmail(
  tx: Prisma.TransactionClient,
  order: { id: string; email: string | null },
  type: EmailType
): Promise<{ queued: boolean } | null> {
  if (!order.email) return null;
  const { count } = await tx.emailOutbox.createMany({
    data: { orderId: order.id, type, toEmail: order.email },
    skipDuplicates: true,
  });
  return { queued: count > 0 };
}
