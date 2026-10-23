/**
 * Fill the payment trail for orders placed before it existed.
 *
 * For every Billplz and ToyyibPay bill on record: read the bill and every
 * attempt the gateway still lists, store them (PaymentAttempt rows plus one
 * GATEWAY_CHECK event, trigger "backfill"), and give a released order with no
 * recorded reason — every Billplz failure so far was stored as UNKNOWN — the
 * one its attempts support. A reason already recorded is never overwritten.
 * Payment state is never changed here: an unpaid bill found paid is reported,
 * and left for the sweep or the order page's "Check now".
 *
 * What it cannot recover: whether the customer opened the payment page, the
 * device, returns and callbacks. Those exist only for orders placed after the
 * trail went live.
 *
 * Reads count against Billplz's 100 GETs per 5 minutes (two per bill), so it
 * paces itself. Dry run by default.
 *
 *   npx tsx scripts/backfill-payment-trail.ts                 # report only
 *   npx tsx scripts/backfill-payment-trail.ts --apply         # write
 *   npx tsx scripts/backfill-payment-trail.ts --gateway billplz
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyInstance } from 'fastify';
import { env } from '../src/config/env.js';
import { getGatewayByBillId } from '../src/utils/payment-gateway.js';
import { inspectAndRecord, refineFailureReason } from '../src/utils/payment-trail.js';

const apply = process.argv.includes('--apply');
const gatewayArg = process.argv[process.argv.indexOf('--gateway') + 1];
const only = process.argv.includes('--gateway') ? gatewayArg : null;

const prisma = new PrismaClient({ adapter: new PrismaPg(env.DATABASE_URL) });
const log = {
  info: () => {},
  warn: (obj: unknown, msg?: string) => console.warn('warn:', msg ?? '', obj),
  error: (obj: unknown, msg?: string) => console.error('error:', msg ?? '', obj),
};
// The trail helpers use fastify.prisma and fastify.log only.
const shim = { prisma, log } as unknown as FastifyInstance;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      paymentRef: { not: null },
      paymentGateway: only ? only : { in: ['billplz', 'toyyibpay'] },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`${orders.length} bill(s) to read${apply ? '' : ' (dry run — nothing will be written)'}\n`);

  let refined = 0;
  let attempts = 0;
  for (const order of orders) {
    const gateway = getGatewayByBillId(order.paymentRef!, order.paymentGateway ?? undefined);
    if (!gateway?.inspectBill) continue;
    try {
      const inspection = apply
        ? await inspectAndRecord(shim, order, 'backfill')
        : await gateway.inspectBill(order.paymentRef!);
      if (!inspection) continue;
      attempts += inspection.attempts.length;
      const counts = ['completed', 'failed', 'pending', 'opened']
        .map((s) => [s, inspection.attempts.filter((a) => a.status === s).length] as const)
        .filter(([, n]) => n > 0)
        .map(([s, n]) => `${n} ${s}`)
        .join(', ');
      let note = '';
      if (inspection.paid && order.paymentStatus === 'UNPAID') note = '  ← PAID at the gateway, still UNPAID here';
      if (inspection.paid && order.paymentStatus === 'FAILED') note = '  ← LATE PAYMENT: paid at the gateway, released here';
      let reason = order.paymentFailureReason ?? '';
      if (apply && order.paymentStatus === 'FAILED') {
        const next = await refineFailureReason(shim, order, inspection);
        if (next !== order.paymentFailureReason) {
          refined++;
          reason = `${order.paymentFailureReason ?? 'null'} → ${next}`;
        }
      } else if (order.paymentStatus === 'FAILED' && (!order.paymentFailureReason || order.paymentFailureReason === 'UNKNOWN')) {
        reason = `${order.paymentFailureReason ?? 'null'} → ${inspection.failureReason} (on --apply)`;
      }
      console.log(
        `${order.orderNumber.padEnd(13)} ${gateway.name.padEnd(9)} ${order.paymentStatus.padEnd(8)} ` +
          `${(inspection.state ?? (inspection.paid ? 'paid' : '-')).padEnd(7)} ${(counts || 'no attempts').padEnd(34)} ${reason}${note}`
      );
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      console.log(`${order.orderNumber.padEnd(13)} ${gateway.name.padEnd(9)} could not read (${status ?? (err as Error).message})`);
      if (status === 429) {
        console.log('Rate-limited by the gateway — waiting 5 minutes.');
        await sleep(5 * 60 * 1000);
      }
    }
    // Billplz: two GETs per bill against 100 per 5 minutes.
    await sleep(gateway.name === 'billplz' ? 7000 : 400);
  }

  console.log(`\n${attempts} attempt(s) read${apply ? `, ${refined} failure reason(s) filled in` : ''}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
