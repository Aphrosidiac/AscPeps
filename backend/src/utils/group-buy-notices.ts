import type { FastifyInstance } from 'fastify';
import { isEmailEnabled, sendEmail } from './email.js';
import { parseStages } from './group-buy.js';
import { renderGroupBuySignup, renderGroupBuyStage } from '../emails/group-buy.js';

/**
 * Group Buy's own small outbox (group_buy_notices): the sign-up welcome and
 * the per-buyer stage update. Rows are written where the event happens and
 * sent here on the same 30-second tick as the order outbox, with the same
 * retry shape. dedupeKey makes each email once.
 */

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000];
const BATCH_SIZE = 10;

/**
 * Queue a stage update for every buyer in the batch: paid orders that are not
 * cancelled or deleted and have an email. Returns how many were queued (rows
 * already queued for this stage are skipped, not resent).
 */
export async function enqueueStageNotices(fastify: FastifyInstance, groupBuyId: string, stageKey: string): Promise<number> {
  const orders = await fastify.prisma.order.findMany({
    where: { groupBuyId, deletedAt: null, status: { not: 'CANCELLED' }, paymentStatus: 'PAID', email: { not: null } },
    select: { id: true, email: true },
  });
  if (orders.length === 0) return 0;
  const res = await fastify.prisma.groupBuyNotice.createMany({
    data: orders.map((o) => ({
      groupBuyId,
      orderId: o.id,
      kind: 'STAGE',
      stageKey,
      toEmail: o.email!,
      dedupeKey: `stage:${stageKey}:${o.id}`,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

async function settingsMap(fastify: FastifyInstance): Promise<Record<string, string>> {
  const rows = await fastify.prisma.setting.findMany();
  return Object.fromEntries(rows.map((s) => [s.key, s.value]));
}

/** Render a queued notice — shared by the worker and the admin email preview. */
export async function renderNotice(
  fastify: FastifyInstance,
  row: { kind: string; groupBuyId: string; orderId: string | null; signupId: string | null; stageKey: string | null },
  settings?: Record<string, string>
): Promise<{ subject: string; html: string } | null> {
  const gb = await fastify.prisma.groupBuy.findUnique({ where: { id: row.groupBuyId } });
  if (!gb) return null;
  const s = settings ?? (await settingsMap(fastify));
  if (row.kind === 'SIGNUP') {
    const signup = row.signupId
      ? await fastify.prisma.groupBuySignup.findUnique({ where: { id: row.signupId }, include: { discountCode: true } })
      : null;
    if (row.signupId && !signup) return null;
    const code = signup?.discountCode;
    return renderGroupBuySignup(
      gb,
      signup?.name ?? null,
      code
        ? { code: code.code, type: code.discountType, value: code.discountValue, expiresAt: code.expiresAt, minOrderAmount: code.minOrderAmount, scope: code.scope }
        : null,
      s
    );
  }
  if (row.kind === 'STAGE') {
    const order = row.orderId
      ? await fastify.prisma.order.findUnique({ where: { id: row.orderId }, select: { orderNumber: true, customerName: true, phone: true, deletedAt: true, status: true } })
      : null;
    if (row.orderId && (!order || order.deletedAt || order.status === 'CANCELLED')) return null;
    return renderGroupBuyStage(
      gb,
      parseStages(gb.stages),
      row.stageKey ?? gb.stageKey,
      order ?? { orderNumber: 'ASC0000/0000', customerName: 'Customer', phone: '' },
      s
    );
  }
  return null;
}

let running = false;

export async function processGroupBuyNotices(fastify: FastifyInstance): Promise<void> {
  if (running || !(await isEmailEnabled(fastify.prisma))) return;
  running = true;
  try {
    const rows = await fastify.prisma.groupBuyNotice.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });
    if (rows.length === 0) return;
    const settings = await settingsMap(fastify);
    for (const row of rows) {
      try {
        const rendered = await renderNotice(fastify, row, settings);
        if (!rendered) {
          await fastify.prisma.groupBuyNotice.update({ where: { id: row.id }, data: { status: 'SKIPPED', lastError: 'no longer eligible' } });
          continue;
        }
        await sendEmail({ to: row.toEmail, subject: rendered.subject, html: rendered.html });
        await fastify.prisma.groupBuyNotice.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date() } });
      } catch (err) {
        const attempts = row.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);
        await fastify.prisma.groupBuyNotice.update({
          where: { id: row.id },
          data: {
            attempts,
            lastError: message.slice(0, 500),
            ...(attempts >= MAX_ATTEMPTS ? { status: 'FAILED' } : { nextAttemptAt: new Date(Date.now() + BACKOFF_MS[attempts - 1]) }),
          },
        });
        fastify.log.warn({ err, noticeId: row.id }, 'group buy notice send failed');
      }
    }
  } finally {
    running = false;
  }
}
