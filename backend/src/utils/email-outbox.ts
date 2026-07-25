import type { Prisma, EmailType } from '@prisma/client';
import { isEmailEnabled } from './email.js';

/**
 * Queue a transactional email for an order. Call inside the SAME transaction
 * as the state change it announces, so a rollback discards the email too.
 *
 * No-op when the order has no email (it's optional at checkout), and
 * skipDuplicates makes a double-fire (payment callback + redirect verify +
 * reconcile sweep can all confirm the same order) a silent no-op against the
 * (orderId, type) unique key instead of a P2002.
 *
 * Also a no-op while sending is disabled — deliberately, rather than queuing
 * anyway for the worker to skip: if nothing gets queued while off, nothing
 * fires a backlog of stale "your order was received" emails days later the
 * moment someone flips the setting back on.
 */
export async function enqueueEmail(
  tx: Prisma.TransactionClient,
  order: { id: string; email: string | null },
  type: EmailType
): Promise<{ queued: boolean } | null> {
  if (!order.email) return null;
  if (!(await isEmailEnabled(tx))) return null;
  const { count } = await tx.emailOutbox.createMany({
    data: { orderId: order.id, type, toEmail: order.email },
    skipDuplicates: true,
  });
  return { queued: count > 0 };
}
