/**
 * A local stand-in for CHIP Collect, for exercising the whole checkout → pay →
 * confirm → refund loop without credentials or real money.
 *
 * Implements only what utils/chip.ts calls, with CHIP's documented contract
 * (docs.chip-in.asia/openapi/chip-collect.yaml): Bearer auth, plural paths with
 * a trailing slash, integer sen, `client.email` + `brand_id` required, a
 * success_callback with an explicit port refused (`webhooks_callback_port`),
 * /public_key/ as a JSON-encoded PEM, and callbacks signed RSA PKCS#1 v1.5 /
 * SHA-256 over the raw body in X-Signature.
 *
 * Its hosted page (/p/<id>/) has Pay / Decline / Return-to-seller buttons that
 * redirect the way CHIP's does. Callbacks it would send to an unreachable
 * localhost URL can be fired at any URL with POST /__mock/callback.
 *
 *   npx tsx scripts/chip-mock.ts            # listens on :4599
 *   CHIP_API_URL=http://localhost:4599/api/v1 CHIP_SECRET_KEY=mock-key CHIP_BRAND_ID=mock-brand npm run dev
 */
import http from 'http';
import crypto from 'crypto';

const PORT = Number(process.env.CHIP_MOCK_PORT ?? 4599);
const KEY = process.env.CHIP_MOCK_KEY ?? 'mock-key';
const BRAND = process.env.CHIP_MOCK_BRAND ?? 'mock-brand';
const IS_TEST = process.env.CHIP_MOCK_IS_TEST !== 'false';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

type Purchase = Record<string, any>;
const purchases = new Map<string, Purchase>();
export const log: string[] = [];

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const fieldError = (res: http.ServerResponse, field: string, message: string, code: string) =>
  json(res, 400, { [field]: [{ message, code }] });

function signedBody(p: Purchase, eventType: string) {
  const raw = Buffer.from(JSON.stringify({ ...p, event_type: eventType }));
  return { raw, signature: crypto.sign('sha256', raw, privateKey).toString('base64') };
}

async function sendCallback(p: Purchase, url: string) {
  const { raw, signature } = signedBody(p, 'purchase.paid');
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': signature }, body: raw });
  log.push(`callback ${p.id} → ${url} ${r.status}`);
  return r.status;
}

function page(p: Purchase) {
  const total = (p.purchase.total / 100).toFixed(2);
  const payable = ['created', 'viewed', 'error', 'overdue'].includes(p.status);
  return `<!doctype html><html><head><meta charset="utf-8"><title>CHIP (mock) — ${p.reference}</title>
<style>body{font:16px system-ui;max-width:420px;margin:60px auto;padding:0 16px}button{display:block;width:100%;margin:8px 0;padding:12px;font:inherit;cursor:pointer}</style></head>
<body><h1>CHIP checkout (mock)</h1><p>${p.purchase.products[0].name}</p><p><strong>RM ${total}</strong> · status <code id="status">${p.status}</code>${p.is_test ? ' · TEST' : ''}</p>
${payable ? `<form method="post" action="/p/${p.id}/pay/"><button name="method" value="fpx">Pay with FPX</button><button name="method" value="duitnow_qr">Pay with DuitNow QR</button></form>
<form method="post" action="/p/${p.id}/decline/"><button>Decline (insufficient funds)</button></form>` : '<p>This purchase can no longer be paid.</p>'}
${p.cancel_redirect ? `<a href="${p.cancel_redirect}">Return to seller</a>` : ''}</body></html>`;
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => json(res, 500, { __all__: [{ message: String(err), code: 'mock_error' }] }));
});

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  log.push(`${req.method} ${url.pathname}`);

  // ---- hosted checkout ----
  const pageMatch = url.pathname.match(/^\/p\/([^/]+)\/(pay\/|decline\/)?$/);
  if (pageMatch) {
    const p = purchases.get(pageMatch[1]);
    if (!p) return json(res, 404, { detail: 'Not found' });
    const action = pageMatch[2];
    if (!action) {
      if (p.status === 'created') p.status = 'viewed';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(page(p));
    }
    const strictlyDue = p.purchase.due_strict && p.due && Date.now() / 1000 > p.due;
    if (!['created', 'viewed', 'error', 'overdue'].includes(p.status) || strictlyDue) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(page(p));
    }
    if (action === 'pay/') {
      const method = new URLSearchParams(raw).get('method') ?? 'fpx';
      const fee = method === 'fpx' ? 100 : Math.max(15, Math.round(p.purchase.total * 0.01));
      p.status = 'paid';
      p.payment = { amount: p.purchase.total, fee_amount: fee, net_amount: p.purchase.total - fee, currency: 'MYR', paid_on: Math.floor(Date.now() / 1000) };
      p.transaction_data.payment_method = method;
      p.transaction_data.attempts.unshift({ type: 'execute', successful: true, payment_method: method, error: null });
      if (p.success_callback) await sendCallback(p, p.success_callback).catch((e) => log.push(`callback failed ${e}`));
      res.writeHead(302, { Location: p.success_redirect ?? `/p/${p.id}/` });
      return res.end();
    }
    p.status = 'error';
    p.transaction_data.attempts.unshift({ type: 'execute', successful: false, payment_method: 'fpx', error: { code: 'insufficient_funds', message: 'Insufficient funds' } });
    res.writeHead(302, { Location: p.failure_redirect ?? `/p/${p.id}/` });
    return res.end();
  }

  // ---- test hooks ----
  if (url.pathname === '/__mock/callback' && req.method === 'POST') {
    const { id, url: target, tamper } = JSON.parse(raw);
    const p = purchases.get(id);
    if (!p) return json(res, 404, {});
    const { raw: body, signature } = signedBody(p, 'purchase.paid');
    const sent = tamper ? Buffer.from(body.toString().replace('"paid"', '"paiD"')) : body;
    const r = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signature': signature }, body: sent });
    return json(res, 200, { status: r.status, body: await r.text() });
  }
  if (url.pathname === '/__mock/state') return json(res, 200, { purchases: [...purchases.values()], log });
  if (url.pathname === '/__mock/set' && req.method === 'POST') {
    const { id, ...patch } = JSON.parse(raw);
    const p = purchases.get(id);
    if (!p) return json(res, 404, {});
    Object.assign(p, patch);
    return json(res, 200, p);
  }

  // ---- API ----
  if (!url.pathname.startsWith('/api/v1/')) return json(res, 404, { detail: 'Not found' });
  if (req.headers.authorization !== `Bearer ${KEY}`) return json(res, 401, { __all__: [{ message: 'Invalid token', code: 'authentication_failed' }] });
  const path = url.pathname.slice('/api/v1'.length);
  if (!path.endsWith('/')) return json(res, 404, { detail: 'Not found (CHIP paths end with a slash)' });

  if (path === '/public_key/' && req.method === 'GET') return json(res, 200, PEM);

  if (path === '/purchases/' && req.method === 'POST') {
    const b = JSON.parse(raw || '{}');
    if (b.brand_id !== BRAND) return fieldError(res, 'brand_id', 'Invalid brand', 'invalid');
    if (!b.client?.email) return fieldError(res, 'client', 'email is required', 'required');
    if (!b.purchase?.products?.length) return fieldError(res, 'purchase', 'products is required', 'required');
    if (b.success_callback && new URL(b.success_callback).port !== '') {
      return fieldError(res, 'success_callback', 'Callback URL must not contain an explicit port', 'webhooks_callback_port');
    }
    if (b.client.phone && !/^\+\d{1,3} \d+$/.test(b.client.phone)) return fieldError(res, 'client', 'Invalid phone', 'invalid');
    const total = b.purchase.products.reduce((s: number, x: any) => s + x.price * Number(x.quantity ?? 1), 0);
    const id = crypto.randomUUID();
    const p: Purchase = {
      ...b,
      id,
      type: 'purchase',
      status: 'created',
      is_test: IS_TEST,
      purchase: { ...b.purchase, total },
      payment: null,
      transaction_data: { payment_method: '', attempts: [] },
      checkout_url: `http://localhost:${PORT}/p/${id}/`,
      refundable_amount: 0,
    };
    purchases.set(id, p);
    return json(res, 201, p);
  }

  const m = path.match(/^\/purchases\/([^/]+)\/(cancel\/|refund\/)?$/);
  const p = m && purchases.get(m[1]);
  if (!m || !p) return json(res, 404, { detail: 'Not found' });
  if (!m[2] && req.method === 'GET') return json(res, 200, p);
  if (m[2] === 'cancel/' && req.method === 'POST') {
    if (['created', 'viewed', 'error', 'overdue', 'sent'].includes(p.status)) p.status = 'cancelled';
    return json(res, 200, p);
  }
  if (m[2] === 'refund/' && req.method === 'POST') {
    if (p.status !== 'paid') return json(res, 400, { __all__: [{ message: 'Purchase is not refundable', code: 'purchase_refund_error' }] });
    const amount = raw ? JSON.parse(raw).amount ?? p.payment.amount : p.payment.amount;
    if (amount > p.payment.amount) return fieldError(res, 'amount', 'Exceeds refundable amount', 'invalid');
    p.status = 'refunded';
    p.refunded = amount;
    return json(res, 200, { id: crypto.randomUUID(), type: 'payment', status: 'success', payment: { amount, currency: 'MYR', payment_type: 'refund' } });
  }
  return json(res, 405, { detail: 'Method not allowed' });
}

server.listen(PORT, () => console.log(`CHIP mock on http://localhost:${PORT} (key ${KEY}, brand ${BRAND}, is_test ${IS_TEST})`));
