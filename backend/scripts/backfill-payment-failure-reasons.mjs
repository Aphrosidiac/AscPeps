// Retroactively classifies every already-FAILED online order by re-querying the
// payment gateway for its bill's transaction rows.
//
// WHY: until now a customer who selected a bank and was refused, and a customer
// who never chose a payment method at all, both ended up as an identical red
// FAILED badge. That is how ASC2608/0021 (RM220, FPX B2C declined by the bank)
// sat unnoticed among eight ordinary abandons. New failures are classified by
// the reconcile sweep; this script is what gives the existing ones the same
// treatment so the history is readable too.
//
// SAFETY — this only ever writes paymentFailureReason/paymentFailureChannel on
// orders that are ALREADY paymentStatus=FAILED. It never changes an order's
// status, never touches stock, and never marks anything paid. If a bill turns
// out to have a successful transaction, that is reported loudly and left alone
// for a human, because reviving a cancelled-and-restocked order is not a
// decision a backfill script should make.
//
// ToyyibPay bills are deactivated when we release an order, but the transaction
// history behind them survives deactivation — verified against real released
// bills — so this works on old orders.
//
// Usage: node scripts/backfill-payment-failure-reasons.mjs [--dry-run] [--force]
//   --dry-run  report what would change, write nothing
//   --force    also re-classify orders that already have a reason recorded
//   (needs DATABASE_URL + TOYYIBPAY_SECRET_KEY — on the VPS:
//    set -a && source .env && set +a)

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

const SECRET_KEY = process.env.TOYYIBPAY_SECRET_KEY;
const SANDBOX = String(process.env.TOYYIBPAY_SANDBOX ?? 'false') === 'true';
const BASE_URL = SANDBOX ? 'https://dev.toyyibpay.com' : 'https://toyyibpay.com';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run: set -a && source .env && set +a');
  process.exit(1);
}
if (!SECRET_KEY) {
  console.error('TOYYIBPAY_SECRET_KEY is not set. Run: set -a && source .env && set +a');
  process.exit(1);
}

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

/**
 * Mirrors getBillTransactions() in src/utils/toyyibpay.ts. Kept as a copy rather
 * than an import because that module pulls in the whole typed env config, which
 * a standalone .mjs script has no business booting. If the classification rules
 * change there, change them here too.
 */
async function classifyBill(billCode) {
  const body = new URLSearchParams({ userSecretKey: SECRET_KEY, billCode });
  const res = await fetch(`${BASE_URL}/index.php/api/getBillTransactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await res.text();
  let rows;
  try {
    rows = JSON.parse(text.trim());
  } catch {
    // "No data found!" and any HTML error page land here.
    return { reason: 'UNKNOWN', channel: null, paid: false };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { reason: 'UNKNOWN', channel: null, paid: false };
  }

  const statusOf = (t) => String(t?.billpaymentStatus ?? '');
  const channelOf = (t) => String(t?.billpaymentChannel ?? '').trim();

  const paidRow = rows.find((t) => statusOf(t) === '1');
  if (paidRow) return { reason: null, channel: channelOf(paidRow) || null, paid: true };

  const declined = rows.find((t) => statusOf(t) === '3');
  if (declined) return { reason: 'DECLINED', channel: channelOf(declined) || null, paid: false };

  const attempted = rows.find((t) => channelOf(t) !== '');
  if (attempted) {
    return { reason: 'ABANDONED_MID_PAYMENT', channel: channelOf(attempted), paid: false };
  }

  return { reason: 'NO_ATTEMPT', channel: null, paid: false };
}

async function main() {
  const orders = await prisma.order.findMany({
    where: {
      paymentStatus: 'FAILED',
      paymentGateway: 'toyyibpay',
      ...(FORCE ? {} : { paymentFailureReason: null }),
    },
    select: {
      id: true,
      orderNumber: true,
      paymentRef: true,
      total: true,
      customerName: true,
      phone: true,
      email: true,
      createdAt: true,
      paymentFailureReason: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(
    `${orders.length} FAILED toyyibpay order(s) to classify${DRY_RUN ? ' (DRY RUN — nothing will be written)' : ''}\n`
  );

  const tally = {};
  const chase = [];
  const paidButFailed = [];

  for (const order of orders) {
    // No bill was ever issued — nothing to ask the gateway about.
    if (!order.paymentRef) {
      const reason = 'NO_BILL';
      tally[reason] = (tally[reason] ?? 0) + 1;
      chase.push({ ...order, reason, channel: null });
      if (!DRY_RUN) {
        await prisma.order.update({
          where: { id: order.id },
          data: { paymentFailureReason: reason, paymentFailureChannel: null },
        });
      }
      console.log(`  ${order.orderNumber.padEnd(14)} NO_BILL (no paymentRef)`);
      continue;
    }

    let result;
    try {
      result = await classifyBill(order.paymentRef);
    } catch (err) {
      console.log(`  ${order.orderNumber.padEnd(14)} SKIPPED — gateway error: ${err.message}`);
      continue;
    }

    if (result.paid) {
      // Do not touch it. A FAILED order whose bill has a successful transaction
      // means we may be holding a customer's money against a cancelled order,
      // which needs a person, not an automatic status change.
      paidButFailed.push(order);
      console.log(
        `  ${order.orderNumber.padEnd(14)} *** BILL HAS A SUCCESSFUL PAYMENT — left untouched, investigate ***`
      );
      continue;
    }

    tally[result.reason] = (tally[result.reason] ?? 0) + 1;
    if (result.reason === 'DECLINED' || result.reason === 'ABANDONED_MID_PAYMENT') {
      chase.push({ ...order, reason: result.reason, channel: result.channel });
    }

    if (!DRY_RUN) {
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentFailureReason: result.reason, paymentFailureChannel: result.channel },
      });
    }

    console.log(
      `  ${order.orderNumber.padEnd(14)} ${result.reason}${result.channel ? ` (${result.channel})` : ''}`
    );
  }

  console.log('\n--- Summary ---');
  for (const [reason, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}  ${reason}`);
  }

  if (chase.length) {
    console.log(`\n--- ${chase.length} lost sale(s) worth following up ---`);
    for (const o of chase) {
      const rm = (o.total / 100).toFixed(2);
      console.log(
        `  ${o.orderNumber}  RM${rm.padStart(8)}  ${o.reason}${o.channel ? ` (${o.channel})` : ''}\n` +
          `      ${o.customerName} — ${o.phone}${o.email ? ` — ${o.email}` : ''} — ${o.createdAt.toISOString().slice(0, 10)}`
      );
    }
  }

  if (paidButFailed.length) {
    console.log(`\n!!! ${paidButFailed.length} order(s) marked FAILED whose bill was actually PAID:`);
    for (const o of paidButFailed) console.log(`  ${o.orderNumber} (bill ${o.paymentRef})`);
    console.log('  These were NOT modified. Check whether the customer was charged.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
