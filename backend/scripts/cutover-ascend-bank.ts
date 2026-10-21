/**
 * Move the old way of settling profit onto Ascend's bank (docs/ascend-bank-plan.md).
 *
 * Two things the old system recorded that the new one reads differently:
 *
 *  1. Orders ticked "Profit Shared" by hand. The money went out outside the
 *     system — profit and fronted capital both — and a payout was almost never
 *     recorded. They go into ONE "shared by hand before Ascend's bank" run,
 *     with every payout recorded before the bank started (the July RM 89.50)
 *     attached to it, so none of it reads as still owed or as paid on account.
 *
 *  2. Capital a partner fronted on orders that are NOT shared yet. Fakhrul,
 *     2026-10-21 (D2, option C): keep it as a debt Ascend repays in parts. It
 *     becomes one ADVANCE per person that never went through the bank, and
 *     each share points at it (capitalFundingId), so the advance is the debt
 *     from now on and the order's capital figure is history.
 *
 * Opt-in and dry-run by default, like backfill-gateway-fees.ts: it changes
 * what people are owed. Re-running is safe — orders already in a run and
 * capital already moved are skipped.
 *
 *   npx tsx scripts/cutover-ascend-bank.ts           # report only
 *   npx tsx scripts/cutover-ascend-bank.ts --apply   # write
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const apply = process.argv.includes('--apply');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const rm = (c: number) => `RM ${(c / 100).toFixed(2)}`;

// The day the bank started (D3: "all goes into bank starting now").
const BANK_START = new Date('2026-10-20T16:00:00Z'); // 21 Oct 2026 00:00 MYT

async function main() {
  /* ---------- 1. hand-ticked orders → one legacy run */
  const ticked = await prisma.order.findMany({
    where: { profitShared: true, payoutRunId: null },
    select: { id: true, orderNumber: true, paymentStatus: true },
    orderBy: { createdAt: 'asc' },
  });
  const loosePayouts = await prisma.profitPayout.findMany({
    where: { runId: null, occurredAt: { lt: BANK_START } },
    include: { partner: { select: { name: true } } },
  });
  console.log(`1. ${ticked.length} order(s) ticked "Profit Shared" by hand → one run "Shared by hand before Ascend's bank".`);
  for (const p of loosePayouts) console.log(`   + payout ${p.partner.name} ${rm(p.amount)} (${p.occurredAt.toISOString().slice(0, 10)}) joins it`);

  /* ---------- 2. capital on unshared orders → an advance per person */
  const shares = await prisma.orderProfitShare.findMany({
    where: {
      capitalAmount: { gt: 0 },
      capitalFundingId: null,
      partnerId: { not: null },
      order: { deletedAt: null, profitShared: false },
    },
    include: { order: { select: { orderNumber: true, paymentStatus: true } }, partner: { select: { name: true } } },
    orderBy: { order: { createdAt: 'asc' } },
  });
  const byPartner = new Map<string, { name: string; amount: number; shareIds: string[]; orders: string[] }>();
  for (const s of shares) {
    const cur = byPartner.get(s.partnerId!) ?? { name: s.partner!.name, amount: 0, shareIds: [], orders: [] };
    cur.amount += s.capitalAmount;
    cur.shareIds.push(s.id);
    cur.orders.push(s.order.paymentStatus === 'PAID' || s.order.paymentStatus === 'REFUNDED' ? s.order.orderNumber : `${s.order.orderNumber} (${s.order.paymentStatus.toLowerCase()})`);
    byPartner.set(s.partnerId!, cur);
  }
  console.log(`\n2. Capital fronted on orders not shared yet → an advance Ascend repays in parts:`);
  if (byPartner.size === 0) console.log('   none');
  for (const p of byPartner.values()) console.log(`   ${p.name}: ${rm(p.amount)} across ${p.orders.length} order(s) — ${p.orders.join(', ')}`);

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to commit.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (ticked.length || loosePayouts.length) {
      const run = await tx.payoutRun.create({
        data: {
          occurredAt: BANK_START,
          legacy: true,
          note: "Shared by hand before Ascend's bank",
          createdBy: 'cutover',
        },
      });
      await tx.order.updateMany({ where: { id: { in: ticked.map((o) => o.id) } }, data: { payoutRunId: run.id } });
      await tx.profitPayout.updateMany({ where: { id: { in: loosePayouts.map((p) => p.id) } }, data: { runId: run.id } });
    }
    for (const [partnerId, p] of byPartner) {
      const funding = await tx.partnerFunding.create({
        data: {
          partnerId,
          type: 'ADVANCE',
          amount: p.amount,
          occurredAt: BANK_START,
          throughBank: false,
          description: `Capital fronted on orders before Ascend's bank (${p.orders.length} order${p.orders.length === 1 ? '' : 's'})`,
        },
      });
      await tx.orderProfitShare.updateMany({ where: { id: { in: p.shareIds } }, data: { capitalFundingId: funding.id } });
    }
  });
  console.log('\nApplied.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
