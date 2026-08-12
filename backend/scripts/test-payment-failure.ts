/**
 * Payment failure classification.
 *
 * No database and no network: every fixture below is a REAL ToyyibPay
 * getBillTransactions response captured from this account's own bills, trimmed
 * to the fields the classifier reads. That matters more than invented cases —
 * the shapes here are the ones that actually occur, including the two that a
 * plausible-looking implementation gets wrong:
 *
 *  - a bill can carry EIGHT channel-less stub rows and one successful payment
 *    (ASC2608/0020), so "any rows exist" must never be read as paid, and a
 *    stub row must never outvote the success;
 *  - a declined attempt is followed by another stub row (ASC2608/0021), so the
 *    decline must win regardless of where it sits in the array.
 *
 * The distinction being protected is the whole point of the feature: DECLINED
 * is a customer who tried to give us money and could not, NO_ATTEMPT is normal
 * drop-off. Collapsing them loses real sales silently.
 *
 *   npx tsx scripts/test-payment-failure.ts
 */
import { classifyBillRows } from '../src/utils/toyyibpay.js';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
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

const row = (status: string, channel = '', amount = '145.00') => ({
  billpaymentStatus: status,
  billpaymentChannel: channel,
  billpaymentAmount: amount,
});

// --- Real bill shapes -------------------------------------------------------

check('ASC2608/0023 — bill issued, no method ever chosen (Imran, RM145)', () => {
  const r = classifyBillRows([row('4', '')]);
  eq(r.paid, false, 'paid:');
  eq(r.failureReason, 'NO_ATTEMPT', 'reason:');
  eq(r.channel, undefined, 'channel:');
});

check('ASC2608/0021 — FPX declined by the bank, then a stub row (RM220)', () => {
  const r = classifyBillRows([row('3', 'FPX B2C', '220.00'), row('4', '', '220.00')]);
  eq(r.paid, false, 'paid:');
  eq(r.failureReason, 'DECLINED', 'reason:');
  eq(r.channel, 'FPX B2C', 'channel:');
});

check('ASC2608/0021 — the decline still wins if the stub row comes first', () => {
  const r = classifyBillRows([row('4', '', '220.00'), row('3', 'FPX B2C', '220.00')]);
  eq(r.failureReason, 'DECLINED', 'reason:');
  eq(r.channel, 'FPX B2C', 'channel:');
});

check('ASC2608/0020 — paid via DuitNow QR among eight stub rows', () => {
  const rows = [
    row('4'), row('4'), row('4'), row('4'),
    row('1', 'DuitNow QR'),
    row('4'), row('4'), row('4'), row('4'),
  ];
  const r = classifyBillRows(rows);
  eq(r.paid, true, 'paid:');
  eq(r.amount, 14500, 'amount (sen):');
  eq(r.channel, 'DuitNow QR', 'channel:');
  eq(r.failureReason, undefined, 'reason:');
});

check('ASC2606/008 — paid via FPX, single row (RM240)', () => {
  const r = classifyBillRows([row('1', 'FPX B2C', '240.00')]);
  eq(r.paid, true, 'paid:');
  eq(r.amount, 24000, 'amount (sen):');
});

// --- The failure modes that would silently lose money -----------------------

check('stub rows alone are never read as payment', () => {
  const r = classifyBillRows([row('4'), row('4'), row('4'), row('4')]);
  eq(r.paid, false, 'paid:');
  eq(r.failureReason, 'NO_ATTEMPT', 'reason:');
});

check('a success anywhere in the array beats every unsuccessful row', () => {
  const r = classifyBillRows([row('3', 'FPX B2C'), row('4'), row('1', 'FPX B2C')]);
  eq(r.paid, true, 'paid:');
  eq(r.failureReason, undefined, 'reason:');
});

check('"No data found!" is UNKNOWN, never paid and never an abandon', () => {
  const r = classifyBillRows('No data found!');
  eq(r.paid, false, 'paid:');
  eq(r.failureReason, 'UNKNOWN', 'reason:');
});

check('an empty array is UNKNOWN, not NO_ATTEMPT', () => {
  // Distinct on purpose: we asked and learned nothing, which is not the same
  // claim as "the customer never tried".
  eq(classifyBillRows([]).failureReason, 'UNKNOWN');
});

check('null / undefined / an object are all UNKNOWN, never paid', () => {
  for (const bad of [null, undefined, {}, 42, '']) {
    const r = classifyBillRows(bad);
    eq(r.paid, false, `paid for ${JSON.stringify(bad)}:`);
    eq(r.failureReason, 'UNKNOWN', `reason for ${JSON.stringify(bad)}:`);
  }
});

check('a channel with no final result is ABANDONED_MID_PAYMENT, not DECLINED', () => {
  // Pending (2) means the customer was handed to the bank and nothing came
  // back — worth chasing, but we must not claim the bank refused them.
  const r = classifyBillRows([row('2', 'FPX B2C'), row('4', '')]);
  eq(r.failureReason, 'ABANDONED_MID_PAYMENT', 'reason:');
  eq(r.channel, 'FPX B2C', 'channel:');
});

check('whitespace-only channels count as no channel', () => {
  eq(classifyBillRows([row('4', '   ')]).failureReason, 'NO_ATTEMPT');
});

check('a missing billpaymentChannel key does not crash or fake an attempt', () => {
  const r = classifyBillRows([{ billpaymentStatus: '4', billpaymentAmount: '145.00' }]);
  eq(r.failureReason, 'NO_ATTEMPT', 'reason:');
});

check('an unparseable amount on a paid row leaves amount undefined, still paid', () => {
  const r = classifyBillRows([row('1', 'FPX B2C', 'n/a')]);
  eq(r.paid, true, 'paid:');
  eq(r.amount, undefined, 'amount:');
});

check('sen conversion rounds rather than truncating', () => {
  eq(classifyBillRows([row('1', 'FPX B2C', '0.07')]).amount, 7);
  eq(classifyBillRows([row('1', 'FPX B2C', '1234.56')]).amount, 123456);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log(`Failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
