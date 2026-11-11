/**
 * Queue the "your pre-order is on track" email for every paid pre-order still
 * waiting to ship (PENDING / CONFIRMED). Lists the orders first; nothing is
 * queued without --send. The email worker sends the queued rows (once per
 * order, retried on failure, visible on Admin → Order emails).
 *
 *   npx tsx scripts/send-preorder-update.ts                       # list only
 *   npx tsx scripts/send-preorder-update.ts --eta "within the next week" --send
 *
 * --eta sets the `preorder_update_eta` setting the email quotes.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEFAULT_PREORDER_UPDATE_ETA } from '../src/emails/preorder-update.js';

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });
const SEND = process.argv.includes('--send');
const etaArg = process.argv.indexOf('--eta');
const eta = etaArg > -1 ? process.argv[etaArg + 1]?.trim() : undefined;

async function main() {
  const orders = await prisma.order.findMany({
    where: { isPreorder: true, deletedAt: null, paymentStatus: 'PAID', status: { in: ['PENDING', 'CONFIRMED'] } },
    select: { id: true, orderNumber: true, customerName: true, email: true, status: true, createdAt: true, emails: { where: { type: 'PREORDER_UPDATE' }, select: { status: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const current = (await prisma.setting.findUnique({ where: { key: 'preorder_update_eta' } }))?.value;
  console.log(`Ships: "${eta || current || DEFAULT_PREORDER_UPDATE_ETA}"${eta ? ' (from --eta)' : ''}\n`);

  let toQueue = 0;
  for (const o of orders) {
    const note = !o.email ? 'NO EMAIL — tell them on WhatsApp' : o.emails.length ? `already queued (${o.emails[0].status})` : 'will send';
    if (o.email && !o.emails.length) toQueue++;
    console.log(`${o.orderNumber.padEnd(14)} ${o.status.padEnd(10)} ${o.createdAt.toISOString().slice(0, 10)}  ${o.customerName.slice(0, 24).padEnd(24)}  ${note}`);
  }
  console.log(`\n${orders.length} paid pre-order(s) waiting to ship, ${toQueue} to email.`);

  if (!SEND) {
    console.log('List only. Add --send to queue them.');
    return;
  }
  if (eta) {
    await prisma.setting.upsert({ where: { key: 'preorder_update_eta' }, update: { value: eta }, create: { key: 'preorder_update_eta', value: eta } });
  }
  const { count } = await prisma.emailOutbox.createMany({
    data: orders.filter((o) => o.email && !o.emails.length).map((o) => ({ orderId: o.id, type: 'PREORDER_UPDATE' as const, toEmail: o.email! })),
    skipDuplicates: true,
  });
  console.log(`Queued ${count}. The email worker sends them within a minute.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
