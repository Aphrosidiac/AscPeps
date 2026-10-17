/**
 * CHIP Collect: purchase classification, phone format and callback signatures.
 *
 * No database and no network. The purchase shapes follow CHIP's OpenAPI spec
 * (docs.chip-in.asia/openapi/chip-collect.yaml) — status enum, transaction_data
 * .attempts[], payment.fee_amount — trimmed to the fields the classifier reads.
 * The cases that matter most:
 *
 *  - a TEST purchase reports `paid` for a test card; on a live deployment it
 *    must never count, or a test key in prod ships real goods for free;
 *  - `pending_execute` is money already with the acquirer: not paid, but the
 *    sweep must not release the stock under it;
 *  - a refused attempt is a DECLINE (a customer who tried to pay), even after
 *    the purchase has since expired — never folded into NO_ATTEMPT.
 *
 * Signatures are checked against a freshly generated RSA key pair, signed
 * exactly the way CHIP documents it: RSA PKCS#1 v1.5 over SHA-256 of the raw
 * body, base64 in X-Signature.
 *
 *   npx tsx scripts/test-chip.ts
 */
import crypto from 'crypto';
import { classifyPurchase, chipPhone, verifySignatureWithKey, type ChipPurchase } from '../src/utils/chip.js';

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

const purchase = (status: string, extra: Partial<ChipPurchase> = {}): ChipPurchase => ({
  id: '1c2f8e0a-6b1a-4c43-9d2e-5b0c1f6a7e11',
  status,
  is_test: false,
  purchase: { total: 14500, currency: 'MYR' },
  payment: null,
  transaction_data: { payment_method: '', attempts: [] },
  ...extra,
});
const live = { acceptTest: false };
const dev = { acceptTest: true };

// ---- classification -----------------------------------------------------

check('paid → paid, with amount, CHIP-reported fee and channel', () => {
  const p = purchase('paid', {
    payment: { amount: 14500, fee_amount: 100 },
    transaction_data: { payment_method: 'fpx', attempts: [{ successful: true, payment_method: 'fpx' }] },
  });
  eq(classifyPurchase(p, live), { paid: true, amount: 14500, fee: 100, channel: 'fpx' });
});

check('cleared / settled are still paid (later card-network stages)', () => {
  eq(classifyPurchase(purchase('cleared', { payment: { amount: 14500 } }), live).paid, true);
  eq(classifyPurchase(purchase('settled', { payment: { amount: 14500 } }), live).paid, true);
});

check('paid with no payment object falls back to purchase.total', () => {
  eq(classifyPurchase(purchase('paid'), live).amount, 14500);
});

check('TEST purchase marked paid is NOT paid on a live deployment', () => {
  const p = purchase('paid', { is_test: true, payment: { amount: 14500, fee_amount: 100 } });
  const r = classifyPurchase(p, live);
  eq(r.paid, false);
  eq(r.failureReason, 'UNKNOWN');
});

check('TEST purchase marked paid IS paid in local dev', () => {
  eq(classifyPurchase(purchase('paid', { is_test: true }), dev).paid, true);
});

check('pending_execute → not paid, pending (holds the release)', () => {
  const r = classifyPurchase(
    purchase('pending_execute', { transaction_data: { payment_method: '', attempts: [{ payment_method: 'fpx' }] } }),
    live
  );
  eq(r, { paid: false, pending: true, failureReason: 'ABANDONED_MID_PAYMENT', channel: 'fpx' });
});

check('error → DECLINED, channel from the refused attempt', () => {
  const p = purchase('error', {
    transaction_data: {
      payment_method: '',
      attempts: [{ successful: false, payment_method: 'visa', error: { code: 'insufficient_funds' } }],
    },
  });
  eq(classifyPurchase(p, live), { paid: false, failureReason: 'DECLINED', channel: 'visa' });
});

check('blocked (fraud scoring) → DECLINED', () => {
  eq(classifyPurchase(purchase('blocked'), live).failureReason, 'DECLINED');
});

check('expired after a refused attempt is still a DECLINE, not an abandon', () => {
  const p = purchase('expired', {
    transaction_data: { payment_method: '', attempts: [{ successful: false, payment_method: 'fpx' }] },
  });
  eq(classifyPurchase(p, live).failureReason, 'DECLINED');
});

check('created / viewed / expired / cancelled with no attempt → NO_ATTEMPT', () => {
  for (const s of ['created', 'sent', 'viewed', 'overdue', 'expired', 'cancelled']) {
    eq(classifyPurchase(purchase(s), live), { paid: false, failureReason: 'NO_ATTEMPT' }, s);
  }
});

check('refunded / chargeback on an unpaid order → not paid, UNKNOWN (for a human)', () => {
  for (const s of ['refunded', 'pending_refund', 'chargeback']) {
    eq(classifyPurchase(purchase(s), live), { paid: false, failureReason: 'UNKNOWN' }, s);
  }
});

check('missing transaction_data does not throw', () => {
  eq(classifyPurchase({ id: 'x', status: 'viewed' }, live), { paid: false, failureReason: 'NO_ATTEMPT' });
});

// ---- phone --------------------------------------------------------------

check('phone → "+60 <number>" from every shape checkout stores', () => {
  eq(chipPhone('0123456789'), '+60 123456789');
  eq(chipPhone('60123456789'), '+60 123456789');
  eq(chipPhone('+60 12-345 6789'), '+60 123456789');
  eq(chipPhone('123456789'), '+60 123456789');
  eq(chipPhone(''), undefined);
});

// ---- signatures ---------------------------------------------------------

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const body = Buffer.from(JSON.stringify({ id: 'abc', status: 'paid', event_type: 'purchase.paid' }));
const sign = (b: Buffer) => crypto.sign('sha256', b, privateKey).toString('base64');

check('a correctly signed raw body verifies', () => {
  eq(verifySignatureWithKey(body, sign(body), pem), true);
});

check('a PEM pasted into .env with literal \\n verifies the same', () => {
  eq(verifySignatureWithKey(body, sign(body), pem.replace(/\n/g, '\\n')), true);
});

check('one changed byte fails', () => {
  const tampered = Buffer.from(body.toString().replace('paid', 'pale'));
  eq(verifySignatureWithKey(tampered, sign(body), pem), false);
});

check('re-serialised JSON (key order / spacing) fails — must be the raw bytes', () => {
  const reserialised = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 1));
  eq(verifySignatureWithKey(reserialised, sign(body), pem), false);
});

check('a signature from another key fails', () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  eq(verifySignatureWithKey(body, crypto.sign('sha256', body, other).toString('base64'), pem), false);
});

check('missing / garbage signature fails without throwing', () => {
  eq(verifySignatureWithKey(body, undefined, pem), false);
  eq(verifySignatureWithKey(body, 'not-base64!!', pem), false);
  eq(verifySignatureWithKey(body, sign(body), 'not a pem'), false);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
