/**
 * The payment trail (utils/payment-trail.ts) and the Billplz attempt verdicts.
 *
 * Part 1 needs nothing: the Billplz fixtures are the REAL transaction lists of
 * this account's bills (GET /v3/bills/:id/transactions, 24 Oct 2026), and the
 * ToyyibPay rows are a real bill's (ASC2608/0026), personal fields dropped.
 *
 * Part 2 writes to a database — DATABASE_URL must NOT be production. It makes
 * its own throwaway orders (number prefix TRAILTEST) and deletes them after.
 * No gateway is called: the paths tested are the ones that need none.
 *
 *   npx tsx scripts/test-payment-trail.ts
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyInstance } from 'fastify';
import { env } from '../src/config/env.js';
import { classifyBillplz, billplzAttempts, type BillplzTransaction } from '../src/utils/billplz.js';
import { toyyibpayAttempts, classifyBillRows } from '../src/utils/toyyibpay.js';
import {
  parseUserAgent,
  withoutSignature,
  recordPaymentEvent,
  upsertAttempts,
  releaseReason,
  refineFailureReason,
} from '../src/utils/payment-trail.js';
import { handlePayLink, handlePaymentCallback } from '../src/modules/payments/payments.controller.js';
import { getPaymentAnalytics } from '../src/modules/admin/admin-payments.controller.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    pass++;
  } catch (e: any) {
    console.log(`✗ ${name} — ${e?.message}`);
    fail++;
    failures.push(name);
  }
}

const eq = (actual: unknown, expected: unknown, msg = '') => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} got ${a}, expected ${b}`);
};

const tx = (id: string, status: string, completed_at: string | null = null): BillplzTransaction => ({
  id,
  status,
  completed_at,
  payment_channel: 'FPX',
});

async function part1() {
  console.log('— Billplz verdicts (real bills)');

  await check('ASC2610/0039 — paid by FPX first time', () => {
    const txns = [tx('83D6C8089B3801E09A8B', 'completed', '2026-10-19T21:40:24.861+08:00')];
    const r = classifyBillplz({ paid: true, paid_amount: 100 }, txns);
    eq(r, { paid: true, amount: 100, channel: 'FPX' });
  });

  await check('ASC2610/0047 — paid after a failed FPX attempt', () => {
    const txns = [
      tx('9EF3E61D780CBF61D325', 'completed', '2026-10-21T19:54:25.944+08:00'),
      tx('D024CA386851FBC4F990', 'failed'),
    ];
    const r = classifyBillplz({ paid: true, paid_amount: 72000 }, txns);
    eq(r.paid, true);
    const attempts = billplzAttempts({ amount: 72000 }, txns);
    eq(attempts.map((a) => a.status), ['failed', 'completed'], 'oldest first:');
    eq(attempts[1].completedAt?.toISOString(), '2026-10-21T11:54:25.944Z', 'completedAt');
    eq(attempts[0].attemptedAt, undefined, 'a failed Billplz attempt has no time');
  });

  await check('ASC2610/0042 — one failed FPX attempt → DECLINED (FPX)', () => {
    const r = classifyBillplz({ paid: false, paid_amount: 0 }, [tx('6A27B2C19BE514E988C4', 'failed')]);
    eq(r, { paid: false, failureReason: 'DECLINED', channel: 'FPX' });
  });

  await check('ASC2610/0054 — no attempts → NO_ATTEMPT (a real answer, not UNKNOWN)', () => {
    eq(classifyBillplz({ paid: false, paid_amount: 0 }, []), { paid: false, failureReason: 'NO_ATTEMPT' });
  });

  await check('a pending attempt → ABANDONED_MID_PAYMENT', () => {
    eq(classifyBillplz({ paid: false, paid_amount: 0 }, [tx('X', 'pending')]).failureReason, 'ABANDONED_MID_PAYMENT');
  });

  await check('a failed attempt outweighs a pending one, whatever the order', () => {
    eq(classifyBillplz({ paid: false, paid_amount: 0 }, [tx('A', 'pending'), tx('B', 'failed')]).failureReason, 'DECLINED');
  });

  console.log('— ToyyibPay rows as attempts (ASC2608/0026)');
  const rows = [
    { billpaymentStatus: '1', billpaymentChannel: 'FPX B2C', billpaymentAmount: '265.00', billpaymentInvoiceNo: 'TP2608142563680016', billPaymentDate: '14-08-2026 21:40:15', billExternalReferenceNo: 'ASC2608/0026' },
    { billpaymentStatus: '3', billpaymentChannel: 'FPX B2C', billpaymentAmount: '265.00', billpaymentInvoiceNo: 'TP2608141891029631', billPaymentDate: '14-08-2026 21:32:54', billExternalReferenceNo: 'ASC2608/0026' },
    { billpaymentStatus: '3', billpaymentChannel: 'DuitNow QR', billpaymentAmount: '265.00', billpaymentInvoiceNo: 'TP2608142342944250', billPaymentDate: '14-08-2026 21:31:29', billExternalReferenceNo: 'ASC2608/0026' },
    { billpaymentStatus: '4', billpaymentChannel: '', billpaymentAmount: '265.00', billpaymentInvoiceNo: 'TP2608142058796928', billPaymentDate: '14-08-2026 21:31:16', billExternalReferenceNo: 'ASC2608/0026' },
  ];

  await check('every row kept, statuses mapped, times read as Malaysia time', () => {
    const a = toyyibpayAttempts(rows);
    eq(a.map((x) => x.status), ['completed', 'failed', 'failed', 'opened']);
    eq(a.map((x) => x.channel), ['FPX B2C', 'FPX B2C', 'DuitNow QR', undefined]);
    eq(a[0].attemptedAt?.toISOString(), '2026-08-14T13:40:15.000Z');
    eq(a[0].completedAt?.toISOString(), '2026-08-14T13:40:15.000Z');
    eq(a[1].completedAt, undefined);
    eq(a[0].amount, 26500);
    eq(a[0].externalId, 'TP2608142563680016');
  });

  await check('the verdict is unchanged by the new reader (still paid)', () => {
    eq(classifyBillRows(rows).paid, true);
  });

  await check('a stub row carrying a channel is a pending attempt, not an opened page', () => {
    eq(toyyibpayAttempts([{ billpaymentStatus: '4', billpaymentChannel: 'FPX B2C' }])[0].status, 'pending');
  });

  await check('"No data found!" gives no attempts', () => {
    eq(toyyibpayAttempts('No data found!'), []);
  });

  await check('a row without an invoice number still gets a stable id', () => {
    const r = { billpaymentStatus: '4', billPaymentDate: '14-08-2026 21:31:16', billExternalReferenceNo: 'ASC2608/0026' };
    eq(toyyibpayAttempts([r])[0].externalId, toyyibpayAttempts([r])[0].externalId);
  });

  console.log('— devices');
  await check('iPhone Safari', () => {
    eq(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'), {
      os: 'iOS', browser: 'Safari', mobile: true,
    });
  });
  await check('Instagram in-app on iPhone', () => {
    const d = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 389.0.0.29.87 (iPhone15,3; iOS 18_5; en_MY)');
    eq([d.os, d.inApp], ['iOS', 'Instagram']);
  });
  await check('TikTok in-app on Android', () => {
    const d = parseUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 trill_370104 BytedanceWebview/d8a21c6');
    eq([d.os, d.inApp, d.mobile], ['Android', 'TikTok', true]);
  });
  await check('Samsung Internet', () => {
    eq(parseUserAgent('Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36').browser, 'Samsung Internet');
  });
  await check('desktop Chrome on Windows', () => {
    eq(parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'), {
      os: 'Windows', browser: 'Chrome', mobile: false,
    });
  });
  await check('signatures never stored', () => {
    eq(withoutSignature({ id: 'a', x_signature: 's', 'billplz[x_signature]': 's', 'billplz[paid]': 'false' }), { id: 'a', 'billplz[paid]': 'false' });
  });
}

async function part2() {
  if (/43\.134|ascend-vps|prod/i.test(env.DATABASE_URL) || !/localhost|127\.0\.0\.1/.test(env.DATABASE_URL)) {
    console.log('\n— database part skipped: DATABASE_URL is not a local database');
    return;
  }
  console.log('\n— database (local)');
  const prisma = new PrismaClient({ adapter: new PrismaPg(env.DATABASE_URL) });
  const quiet = { info: () => {}, warn: () => {}, error: () => {} };
  const fastify = { prisma, log: quiet } as unknown as FastifyInstance;
  const stamp = Date.now().toString(36);
  const made: string[] = [];

  const makeOrder = async (suffix: string, extra: Record<string, unknown> = {}) => {
    const o = await prisma.order.create({
      data: {
        orderNumber: `TRAILTEST-${stamp}-${suffix}`,
        customerName: 'Trail Test',
        phone: `0199${stamp.slice(-6)}`,
        address: '1 Test St',
        city: 'KL',
        state: 'Kuala Lumpur',
        postcode: '50000',
        total: 14500,
        paymentMethod: 'BILLPLZ',
        paymentGateway: 'billplz',
        paymentRef: `trailtest${stamp}${suffix}`,
        ...extra,
      },
    });
    made.push(o.id);
    return o;
  };

  try {
    await check('attempts upsert on (gateway, id): a re-read updates, never duplicates', async () => {
      const o = await makeOrder('a');
      const a1 = billplzAttempts({ amount: 14500 }, [tx(`T${stamp}1`, 'pending')]);
      eq(await upsertAttempts(fastify, o.id, 'billplz', a1), 1, 'first sight:');
      const first = await prisma.paymentAttempt.findFirstOrThrow({ where: { orderId: o.id } });
      eq(await upsertAttempts(fastify, o.id, 'billplz', a1), 0, 'unchanged:');
      const a2 = billplzAttempts({ amount: 14500 }, [tx(`T${stamp}1`, 'failed')]);
      eq(await upsertAttempts(fastify, o.id, 'billplz', a2), 1, 'status changed:');
      const rows = await prisma.paymentAttempt.findMany({ where: { orderId: o.id } });
      eq(rows.length, 1);
      eq(rows[0].status, 'failed');
      eq(rows[0].firstSeenAt.getTime(), first.firstSeenAt.getTime(), 'firstSeenAt kept:');
    });

    await check('NEVER_OPENED: tracked bill, no visit, no attempt', async () => {
      const o = await makeOrder('b');
      await recordPaymentEvent(fastify, { orderId: o.id, type: 'BILL_CREATED', gateway: 'billplz', data: {} });
      eq(await releaseReason(fastify, o.id, 'NO_ATTEMPT', []), 'NEVER_OPENED');
    });

    await check('NO_ATTEMPT stays when the page was opened', async () => {
      const o = await makeOrder('c');
      await recordPaymentEvent(fastify, { orderId: o.id, type: 'BILL_CREATED', gateway: 'billplz', data: {} });
      await recordPaymentEvent(fastify, { orderId: o.id, type: 'PAGE_OPENED', gateway: 'billplz', data: {} });
      eq(await releaseReason(fastify, o.id, 'NO_ATTEMPT', []), 'NO_ATTEMPT');
    });

    await check('NO_ATTEMPT stays for an order from before the trail (no BILL_CREATED)', async () => {
      const o = await makeOrder('d');
      eq(await releaseReason(fastify, o.id, 'NO_ATTEMPT', []), 'NO_ATTEMPT');
    });

    await check('a declined order is never turned into NEVER_OPENED', async () => {
      const o = await makeOrder('e');
      await recordPaymentEvent(fastify, { orderId: o.id, type: 'BILL_CREATED', gateway: 'billplz', data: {} });
      eq(await releaseReason(fastify, o.id, 'DECLINED', []), 'DECLINED');
    });

    await check('refine: UNKNOWN → DECLINED (FPX); a recorded reason is left alone', async () => {
      const o = await makeOrder('f', { paymentStatus: 'FAILED', status: 'CANCELLED', paymentFailureReason: 'UNKNOWN' });
      const txns = [tx(`T${stamp}f`, 'failed')];
      const inspection = { ...classifyBillplz({ paid: false, paid_amount: 0 }, txns), attempts: billplzAttempts({ amount: 14500 }, txns), raw: {} };
      eq(await refineFailureReason(fastify, o, inspection), 'DECLINED');
      const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      eq([after.paymentFailureReason, after.paymentFailureChannel], ['DECLINED', 'FPX']);
      eq(await refineFailureReason(fastify, after, { ...inspection, failureReason: 'NO_ATTEMPT' }), 'DECLINED', 'kept:');
    });

    await check('pay link: records the visit with device + source, sends to the Billplz page', async () => {
      const o = await makeOrder('g');
      const client = { userAgent: 'x', country: 'MY', device: parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) Instagram 1') };
      const url = await handlePayLink(fastify, o.paymentRef!, 'email', client);
      if (!url.endsWith(`/bills/${o.paymentRef}`)) throw new Error(`redirected to ${url}`);
      const ev = await prisma.paymentEvent.findFirstOrThrow({ where: { orderId: o.id, type: 'PAGE_OPENED' } });
      const data = ev.data as { src: string; client: { country: string; device: { inApp: string } } };
      eq([data.src, data.client.country, data.client.device.inApp], ['email', 'MY', 'Instagram']);
    });

    await check('pay link: an id that is not ours goes to the failed page and records nothing', async () => {
      const url = await handlePayLink(fastify, `nope${stamp}`, 'checkout', { device: parseUserAgent('') });
      if (!url.endsWith('/checkout/failed')) throw new Error(url);
    });

    await check('a callback with a bad signature is refused AND kept on the trail', async () => {
      const o = await makeOrder('h');
      let refused = false;
      try {
        await handlePaymentCallback(fastify, { id: o.paymentRef!, paid: 'true', state: 'paid', x_signature: 'deadbeef' });
      } catch (e: any) {
        refused = e?.statusCode === 400;
      }
      eq(refused, true, 'refused:');
      const ev = await prisma.paymentEvent.findFirstOrThrow({ where: { orderId: o.id, type: 'CALLBACK' } });
      const data = ev.data as { signatureValid: boolean; fields: Record<string, string> };
      eq([data.signatureValid, data.fields.paid, 'x_signature' in data.fields], [false, 'true', false]);
      const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      eq(after.paymentStatus, 'UNPAID', 'not marked paid:');
    });

    await check('analytics: reasons, recovery by the same phone, test orders left out', async () => {
      const phone = `0177${stamp.slice(-6)}`;
      const lost = await makeOrder('i', { phone, paymentStatus: 'FAILED', status: 'CANCELLED', paymentFailureReason: 'DECLINED', paymentFailureChannel: 'FPX' });
      await upsertAttempts(fastify, lost.id, 'billplz', billplzAttempts({ amount: 14500 }, [tx(`T${stamp}i`, 'failed')]));
      const recovered = await makeOrder('j', { phone, paymentStatus: 'FAILED', status: 'CANCELLED', paymentFailureReason: 'NO_ATTEMPT' });
      await new Promise((r) => setTimeout(r, 5));
      const later = await makeOrder('k', { phone, paymentMethod: 'WHATSAPP', paymentGateway: null, paymentRef: null, paymentStatus: 'PAID', status: 'CONFIRMED' });
      const test = await makeOrder('l', { paymentStatus: 'FAILED', status: 'CANCELLED', paymentFailureReason: 'NO_ATTEMPT', isTest: true });

      const res = (await getPaymentAnalytics(fastify, { days: '1' })) as any;
      const mine = res.failedOrders.filter((f: any) => f.orderNumber.startsWith(`TRAILTEST-${stamp}`));
      const byNo = Object.fromEntries(mine.map((f: any) => [f.orderNumber, f]));
      // `lost` was placed before `later` too, so the same phone recovers both —
      // that is the rule: any paid order by that phone within 7 days after.
      eq(!!byNo[lost.orderNumber].recoveredBy, true, 'lost recovered by later:');
      eq(byNo[recovered.orderNumber].recoveredBy?.orderNumber, later.orderNumber, 'recovered by:');
      eq(byNo[lost.orderNumber].attempts.failed, 1, 'attempts:');
      eq(byNo[test.orderNumber], undefined, 'test order excluded:');
      const withTests = (await getPaymentAnalytics(fastify, { days: '1', tests: '1' })) as any;
      eq(withTests.failedOrders.some((f: any) => f.orderNumber === test.orderNumber), true, 'included on request:');
      const fpx = res.attempts.byChannel.find((c: any) => c.channel === 'FPX');
      if (!fpx || fpx.failed < 1) throw new Error('FPX failures not counted');
    });
  } finally {
    await prisma.order.deleteMany({ where: { id: { in: made } } });
    await prisma.$disconnect();
  }
}

(async () => {
  await part1();
  await part2();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) {
    console.log(failures.map((f) => `  - ${f}`).join('\n'));
    process.exitCode = 1;
  }
})();
