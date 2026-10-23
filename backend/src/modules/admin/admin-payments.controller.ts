import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * Admin → Payments: why online payments do and don't go through.
 *
 * Built from the payment trail (utils/payment-trail.ts) over the online orders
 * placed in the period — Billplz and ToyyibPay bills, never WhatsApp or bank
 * transfer, which have no gateway to fail. Test orders are left out unless
 * asked for. Everything is computed here, per request: the volume is a few
 * hundred orders, and a figure derived on read can never drift from the
 * orders it describes.
 *
 * "Recovered" is the question that decides whether a failure cost anything:
 * did the same phone number pay for an order (any method) within 7 days after
 * this one was placed? A customer who failed on FPX and then bought over
 * WhatsApp is not a lost sale.
 */

const querySchema = z.object({
  days: z.coerce.number().int().min(0).max(3650).default(30),
  gateway: z.enum(['all', 'billplz', 'toyyibpay']).default('all'),
  tests: z.enum(['0', '1']).default('0'),
});

const RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PAID = new Set(['PAID', 'REFUNDED']);

type Device = { os?: string; browser?: string; inApp?: string; mobile?: boolean };

function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function deviceLabel(d: Device | null | undefined): string {
  if (!d) return 'Not recorded';
  const base = `${d.os ?? 'Other'} · ${d.browser ?? 'Other'}`;
  return d.inApp ? `${d.os ?? 'Other'} · ${d.inApp} in-app` : base;
}

export async function getPaymentAnalytics(fastify: FastifyInstance, rawQuery: unknown) {
  const q = querySchema.parse(rawQuery ?? {});
  const since = q.days > 0 ? new Date(Date.now() - q.days * 24 * 60 * 60 * 1000) : null;
  const gateways = q.gateway === 'all' ? ['billplz', 'toyyibpay'] : [q.gateway];

  const orders = await fastify.prisma.order.findMany({
    where: {
      paymentMethod: 'BILLPLZ',
      deletedAt: null,
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(q.tests === '1' ? {} : { isTest: false }),
      // An order with no gateway never got as far as a bill; it is counted
      // under the gateway it was meant for only when that is known, so
      // "all" also takes the gateway-less NO_BILL orders.
      OR: [{ paymentGateway: { in: gateways } }, ...(q.gateway === 'all' ? [{ paymentGateway: null }] : [])],
    },
    select: {
      id: true,
      orderNumber: true,
      customerName: true,
      phone: true,
      total: true,
      createdAt: true,
      paidAt: true,
      paymentGateway: true,
      paymentStatus: true,
      paymentFailureReason: true,
      paymentFailureChannel: true,
      isTest: true,
      paymentAttempts: { select: { status: true, channel: true, firstSeenAt: true, attemptedAt: true } },
      paymentEvents: { select: { type: true, at: true, data: true }, orderBy: { at: 'asc' } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Later paid orders by the same phones, for "recovered".
  const phones = [...new Set(orders.filter((o) => o.paymentStatus === 'FAILED').map((o) => o.phone))];
  const laterPaid = phones.length
    ? await fastify.prisma.order.findMany({
        where: { phone: { in: phones }, paymentStatus: { in: ['PAID', 'REFUNDED'] }, deletedAt: null },
        select: { id: true, orderNumber: true, phone: true, total: true, createdAt: true, paymentMethod: true, paymentGateway: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const trackingSince = await fastify.prisma.paymentEvent.findFirst({
    where: { type: 'PAGE_OPENED' },
    orderBy: { at: 'asc' },
    select: { at: true },
  });
  const billTrackingSince = await fastify.prisma.paymentEvent.findFirst({
    where: { type: 'BILL_CREATED' },
    orderBy: { at: 'asc' },
    select: { at: true },
  });

  const realAttempt = (a: { status: string }) => a.status !== 'opened';

  const funnel = { placed: 0, billCreated: 0, billFailed: 0, tracked: 0, opened: 0, attempted: 0, paid: 0 };
  const totals = { orders: 0, paid: 0, paidAmount: 0, open: 0, openAmount: 0, failed: 0, failedAmount: 0, recovered: 0, recoveredAmount: 0, lost: 0, lostAmount: 0 };
  const reasons = new Map<string, { reason: string; orders: number; amount: number; recovered: number; lost: number; lostAmount: number }>();
  const channels = new Map<string, { channel: string; attempts: number; completed: number; failed: number; pending: number; orders: number; paidOrders: number }>();
  const devices = new Map<string, { device: string; orders: number; paid: number; failed: number; open: number }>();
  const byGateway = new Map<string, { gateway: string; orders: number; paid: number; failed: number; paidAmount: number }>();
  const attemptTotals = { total: 0, completed: 0, failed: 0, pending: 0, ordersAttempted: 0, paidFirstTry: 0, paidAfterRetry: 0 };
  const minutesToPay: number[] = [];
  const minutesToOpen: number[] = [];
  const failedOrders: unknown[] = [];

  for (const o of orders) {
    const paid = PAID.has(o.paymentStatus);
    const failed = o.paymentStatus === 'FAILED';
    const events = o.paymentEvents;
    const has = (type: string) => events.some((e) => e.type === type);
    const placedEvent = events.find((e) => e.type === 'ORDER_PLACED');
    const device = ((placedEvent?.data as { client?: { device?: Device } } | null)?.client?.device) ?? null;
    const opens = events.filter((e) => e.type === 'PAGE_OPENED');
    const returns = events.filter((e) => e.type === 'RETURNED');
    const attempts = o.paymentAttempts.filter(realAttempt);
    // A bill exists if one was recorded, or — for orders older than the trail —
    // if the order carries a gateway at all.
    const billCreated = has('BILL_CREATED') || !!o.paymentGateway;
    const tracked = has('BILL_CREATED');

    totals.orders++;
    funnel.placed++;
    if (billCreated) funnel.billCreated++;
    if (has('BILL_FAILED') || o.paymentFailureReason === 'NO_BILL') funnel.billFailed++;
    if (tracked) {
      funnel.tracked++;
      if (opens.length) funnel.opened++;
    }
    if (attempts.length) {
      funnel.attempted++;
      attemptTotals.ordersAttempted++;
    }
    if (paid) {
      funnel.paid++;
      totals.paid++;
      totals.paidAmount += o.total;
      const failedBefore = attempts.filter((a) => a.status === 'failed').length;
      if (attempts.length) {
        if (failedBefore > 0) attemptTotals.paidAfterRetry++;
        else attemptTotals.paidFirstTry++;
      }
      if (o.paidAt) minutesToPay.push((o.paidAt.getTime() - o.createdAt.getTime()) / 60000);
    } else if (failed) {
      totals.failed++;
      totals.failedAmount += o.total;
    } else {
      totals.open++;
      totals.openAmount += o.total;
    }
    if (opens.length) minutesToOpen.push((opens[0].at.getTime() - o.createdAt.getTime()) / 60000);

    const gw = o.paymentGateway ?? 'none';
    const g = byGateway.get(gw) ?? { gateway: gw, orders: 0, paid: 0, failed: 0, paidAmount: 0 };
    g.orders++;
    if (paid) {
      g.paid++;
      g.paidAmount += o.total;
    }
    if (failed) g.failed++;
    byGateway.set(gw, g);

    const dKey = deviceLabel(device);
    const d = devices.get(dKey) ?? { device: dKey, orders: 0, paid: 0, failed: 0, open: 0 };
    d.orders++;
    if (paid) d.paid++;
    else if (failed) d.failed++;
    else d.open++;
    devices.set(dKey, d);

    const seenChannels = new Set<string>();
    for (const a of attempts) {
      attemptTotals.total++;
      const ch = a.channel || 'Unknown';
      const c = channels.get(ch) ?? { channel: ch, attempts: 0, completed: 0, failed: 0, pending: 0, orders: 0, paidOrders: 0 };
      c.attempts++;
      if (a.status === 'completed') {
        c.completed++;
        attemptTotals.completed++;
      } else if (a.status === 'failed') {
        c.failed++;
        attemptTotals.failed++;
      } else {
        c.pending++;
        attemptTotals.pending++;
      }
      if (!seenChannels.has(ch)) {
        c.orders++;
        if (paid) c.paidOrders++;
        seenChannels.add(ch);
      }
      channels.set(ch, c);
    }

    if (!failed) continue;

    const reason = o.paymentFailureReason ?? 'UNKNOWN';
    const later = laterPaid.find(
      (p) => p.phone === o.phone && p.id !== o.id && p.createdAt > o.createdAt && p.createdAt.getTime() - o.createdAt.getTime() <= RECOVERY_WINDOW_MS
    );
    const r = reasons.get(reason) ?? { reason, orders: 0, amount: 0, recovered: 0, lost: 0, lostAmount: 0 };
    r.orders++;
    r.amount += o.total;
    if (later) {
      r.recovered++;
      totals.recovered++;
      totals.recoveredAmount += o.total;
    } else {
      r.lost++;
      r.lostAmount += o.total;
      totals.lost++;
      totals.lostAmount += o.total;
    }
    reasons.set(reason, r);

    const lastReturn = returns[returns.length - 1]?.data as { params?: Record<string, string> } | undefined;
    failedOrders.push({
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      total: o.total,
      customerName: o.customerName,
      gateway: o.paymentGateway,
      reason,
      channel: o.paymentFailureChannel,
      attempts: {
        failed: attempts.filter((a) => a.status === 'failed').length,
        pending: attempts.filter((a) => a.status === 'pending').length,
        channels: [...new Set(attempts.map((a) => a.channel).filter(Boolean))],
      },
      tracked,
      opens: opens.length,
      openSources: [...new Set(opens.map((e) => (e.data as { src?: string })?.src).filter(Boolean))],
      returns: returns.length,
      lastReturnPaid: lastReturn?.params ? lastReturn.params['billplz[paid]'] ?? lastReturn.params.status_id ?? null : null,
      device,
      isTest: o.isTest,
      recoveredBy: later
        ? {
            id: later.id,
            orderNumber: later.orderNumber,
            total: later.total,
            method: later.paymentMethod,
            gateway: later.paymentGateway,
            hoursLater: Math.round(((later.createdAt.getTime() - o.createdAt.getTime()) / 3600000) * 10) / 10,
          }
        : null,
    });
  }

  const sortDesc = <T extends { orders: number }>(rows: T[]) => rows.sort((a, b) => b.orders - a.orders);

  return {
    period: { days: q.days, since, gateway: q.gateway, includeTests: q.tests === '1' },
    // Page visits are known only for bills sent through the pay link; before
    // that the funnel can't say who opened the page.
    trackingSince: billTrackingSince?.at ?? trackingSince?.at ?? null,
    totals: { ...totals, conversion: totals.orders ? totals.paid / totals.orders : null },
    funnel,
    reasons: [...reasons.values()].sort((a, b) => b.orders - a.orders),
    attempts: {
      ...attemptTotals,
      failureRate: attemptTotals.total ? attemptTotals.failed / attemptTotals.total : null,
      byChannel: [...channels.values()].sort((a, b) => b.attempts - a.attempts),
    },
    byGateway: sortDesc([...byGateway.values()]),
    devices: sortDesc([...devices.values()]),
    timing: { medianMinutesToPay: median(minutesToPay), medianMinutesToFirstOpen: median(minutesToOpen) },
    failedOrders,
  };
}
