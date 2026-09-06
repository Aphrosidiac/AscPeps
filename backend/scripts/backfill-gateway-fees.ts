/**
 * Stamp the gateway fee onto orders confirmed paid BEFORE the column existed.
 *
 * Those orders really were charged a processor fee — it was simply recorded
 * nowhere, so their profit reads high by exactly that much. New orders stamp
 * themselves at the PAID transition (utils/payment-reconcile.ts); this is only
 * for the history behind that point.
 *
 * Deliberately opt-in and dry-run by default. This rewrites what people were
 * told they earned, which is not something a migration should do quietly.
 *
 *   npx tsx scripts/backfill-gateway-fees.ts           # report only
 *   npx tsx scripts/backfill-gateway-fees.ts --apply   # write
 *
 * Orders that already carry a non-zero fee are never touched, so re-running is
 * safe and a hand-corrected figure is never overwritten.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { computeGatewayFee } from '../src/utils/gateway-fee.js';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

// computeGatewayFee reads overrides through fastify.prisma; this stands in for
// the one property it uses.
const shim = { prisma } as unknown as Parameters<typeof computeGatewayFee>[0];

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      paymentStatus: { in: ['PAID', 'REFUNDED'] },
      gatewayFee: 0,
      paymentGateway: { not: null },
    },
    select: { id: true, orderNumber: true, total: true, paymentGateway: true },
    orderBy: { createdAt: 'asc' },
  });

  let total = 0;
  const writes: { id: string; fee: number }[] = [];

  for (const order of orders) {
    const fee = await computeGatewayFee(shim, order.paymentGateway, order.total);
    if (fee === 0) continue;
    total += fee;
    writes.push({ id: order.id, fee });
    console.log(
      `${order.orderNumber}  ${order.paymentGateway?.padEnd(10)}  total RM${(order.total / 100).toFixed(2).padStart(8)}  fee RM${(fee / 100).toFixed(2)}`
    );
  }

  console.log(
    `\n${writes.length} order(s), RM${(total / 100).toFixed(2)} of fees never recorded.` +
      `\nProfit across those orders is currently overstated by that amount.`
  );

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to commit.');
    return;
  }

  // One transaction: a half-applied backfill would leave the books in a state
  // neither before nor after, and no way to tell which orders were done.
  await prisma.$transaction(
    writes.map((w) => prisma.order.update({ where: { id: w.id }, data: { gatewayFee: w.fee } }))
  );
  console.log(`\nApplied to ${writes.length} order(s).`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
