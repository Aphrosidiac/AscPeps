import { env } from '../config/env.js';
import * as billplz from './billplz.js';
import * as toyyibpay from './toyyibpay.js';
import * as btcpay from './btcpay.js';
import * as chip from './chip.js';

export type { PaymentFailureReason, BillTransactionStatus } from './toyyibpay.js';
import type { BillTransactionStatus } from './toyyibpay.js';

export interface CreateBillParams {
  name: string;
  email?: string;
  phone: string;
  amount: number;
  description: string;
  orderNumber: string;
  orderId: string;
}

export interface BillResult {
  billId: string;
  paymentUrl: string;
  gateway: string;
}

export interface CallbackResult {
  billId: string;
  // 'paid'    — payment confirmed
  // 'failed'  — gateway reported an explicit failure (safe to release stock)
  // 'pending' — not yet final; do nothing and wait for the next callback
  status: 'paid' | 'failed' | 'pending';
  amount?: number; // sen/cents, best-effort, for verification only
  orderRef?: string;
}

export interface PaymentGateway {
  name: string;
  createBill(params: CreateBillParams): Promise<BillResult>;
  verifyCallback(body: Record<string, string>): boolean;
  parseCallback(body: Record<string, string>): CallbackResult;
  /**
   * Which page the returning customer lands on. `verifiedPaid` is what a
   * server-side re-query of the bill just said, so the page can't contradict
   * the order state we already committed.
   */
  buildRedirectUrl(query: Record<string, string>, verifiedPaid?: boolean): string;
  /**
   * Re-query the gateway for the authoritative paid state of a bill.
   *
   * When the answer is "not paid", a gateway that can tell whether the customer
   * ever actually attempted payment should say so via `failureReason` — that is
   * what separates a lost sale from an ordinary abandon. A gateway with no such
   * detail should leave it undefined rather than guess; the caller records
   * UNKNOWN instead of inventing a story about the customer.
   */
  verifyPaid(billId: string): Promise<BillTransactionStatus>;
  /** Best-effort: stop a bill being payable after we've released its stock. */
  deactivateBill?(billId: string): Promise<boolean>;
  /** Where to send a customer to finish paying an existing, still-open bill. */
  billUrl(billId: string): string;
}

function getBackendUrl(): string {
  if (env.FRONTEND_URL.startsWith('http://localhost')) return `http://localhost:${env.PORT}`;
  const url = new URL(env.FRONTEND_URL);
  return `https://${url.hostname}`;
}

function getFrontendUrl(): string {
  return env.FRONTEND_URL;
}

/**
 * A real deployment, as opposed to local dev. NODE_ENV is deliberately not the
 * signal: it is unset on the live PM2 process, so a NODE_ENV check would
 * silently never fire. Reuse getBackendUrl's convention instead: a
 * non-localhost FRONTEND_URL means this is a real deployment.
 */
function isLiveDeployment(): boolean {
  return !env.FRONTEND_URL.startsWith('http://localhost');
}

/**
 * The failure page carries the still-open bill so the customer can resume the
 * payment they just abandoned, instead of rebuilding the whole order (which
 * reserves a second lot of stock and can hard-block them on a low-stock
 * variant). The frontend re-validates the host before rendering it as a link.
 */
function failedUrl(frontendUrl: string, retryUrl?: string | false): string {
  const base = `${frontendUrl}/checkout/failed`;
  return retryUrl ? `${base}?retry=${encodeURIComponent(retryUrl)}` : base;
}

const billplzGateway: PaymentGateway = {
  name: 'billplz',
  async createBill(params) {
    const backendUrl = getBackendUrl();
    const bill = await billplz.createBill({
      collectionId: env.BILLPLZ_COLLECTION_ID!,
      name: params.name,
      email: params.email,
      mobile: params.phone.startsWith('60') ? params.phone : `60${params.phone.replace(/^0/, '')}`,
      amount: params.amount,
      description: params.description,
      callbackUrl: `${backendUrl}/api/v1/payments/callback`,
      redirectUrl: `${backendUrl}/api/v1/payments/redirect`,
      referenceOne: params.orderNumber,
    });
    return { billId: bill.id, paymentUrl: bill.url, gateway: 'billplz' };
  },
  verifyCallback(body) {
    return billplz.verifyCallbackSignature(body);
  },
  parseCallback(body) {
    const paid = body.paid === 'true' && body.state === 'paid';
    return {
      billId: body.id,
      // Billplz only fires a meaningful callback when a bill is paid; an
      // unpaid/"due" callback is treated as pending (never auto-failed) so the
      // stale-order reconciler decides its fate instead.
      status: paid ? 'paid' : 'pending',
      amount: body.paid_amount ? parseInt(body.paid_amount, 10) : undefined,
      orderRef: body.id,
    };
  },
  buildRedirectUrl(query, verifiedPaid) {
    const valid = billplz.verifyRedirectSignature(query);
    const paid = verifiedPaid || (valid && query['billplz[paid]'] === 'true');
    const frontendUrl = getFrontendUrl();
    return paid
      ? `${frontendUrl}/checkout/success`
      : failedUrl(frontendUrl, query['billplz[id]'] && this.billUrl(query['billplz[id]']));
  },
  async verifyPaid(billId) {
    const bill = await billplz.getBill(billId);
    // Billplz's bill resource reports only the final state ("due"/"paid"), not
    // whether the payer ever selected a bank — so there is nothing here that
    // could distinguish a decline from an abandon. Left undefined on purpose.
    return { paid: bill.paid, amount: bill.paid_amount };
  },
  billUrl(billId) {
    const host = env.BILLPLZ_SANDBOX ? 'https://www.billplz-sandbox.com' : 'https://www.billplz.com';
    return `${host}/bills/${billId}`;
  },
};

const toyyibpayGateway: PaymentGateway = {
  name: 'toyyibpay',
  async createBill(params) {
    const backendUrl = getBackendUrl();
    const billCode = await toyyibpay.createBill({
      secretKey: env.TOYYIBPAY_SECRET_KEY!,
      categoryCode: env.TOYYIBPAY_CATEGORY_CODE!,
      name: params.name,
      email: params.email || '',
      phone: params.phone,
      amount: params.amount,
      description: params.description,
      orderNumber: params.orderNumber,
      callbackUrl: `${backendUrl}/api/v1/payments/callback`,
      returnUrl: `${backendUrl}/api/v1/payments/redirect`,
    });
    return { billId: billCode, paymentUrl: this.billUrl(billCode), gateway: 'toyyibpay' };
  },
  verifyCallback(body) {
    return toyyibpay.verifyCallbackHash(body, env.TOYYIBPAY_SECRET_KEY!);
  },
  parseCallback(body) {
    // ToyyibPay status: 1 = success, 2 = pending, 3 = fail.
    // Only an explicit fail (3) releases stock; pending (2) must NOT mark the
    // order failed, otherwise the later success callback is ignored.
    const status =
      body.status === '1' ? 'paid' : body.status === '3' ? 'failed' : 'pending';
    // ToyyibPay's server-to-server callback `amount` is ALWAYS in sen (e.g.
    // "1150" = RM11.50), unlike getBillTransactions which returns RM. Parse as
    // an integer; guard against non-numeric so a bad value becomes undefined,
    // not NaN.
    const parsedAmount = body.amount != null ? parseInt(body.amount, 10) : NaN;
    const amount = Number.isFinite(parsedAmount) ? parsedAmount : undefined;
    return { billId: body.billcode, status, amount, orderRef: body.order_id };
  },
  buildRedirectUrl(query, verifiedPaid) {
    // Either signal is enough to show success. The re-query is authoritative
    // when it says paid, but it can legitimately lag the bank's redirect by a
    // few seconds — so a bare status_id=1 must still land on the success page
    // rather than telling a paying customer their payment failed. Neither of
    // these marks the order paid; only applyPaid() does, from verifyPaid().
    const paid = verifiedPaid || query.status_id === '1';
    const frontendUrl = getFrontendUrl();
    return paid
      ? `${frontendUrl}/checkout/success`
      : failedUrl(frontendUrl, query.billcode && this.billUrl(query.billcode));
  },
  async verifyPaid(billId) {
    return toyyibpay.getBillTransactions(billId, env.TOYYIBPAY_SECRET_KEY!);
  },
  async deactivateBill(billId) {
    return toyyibpay.inactiveBill(billId, env.TOYYIBPAY_SECRET_KEY!);
  },
  billUrl(billId) {
    const host = env.TOYYIBPAY_SANDBOX ? 'https://dev.toyyibpay.com' : 'https://toyyibpay.com';
    return `${host}/${billId}`;
  },
};

const btcpayGateway: PaymentGateway = {
  name: 'btcpay',
  async createBill(params) {
    const backendUrl = getBackendUrl();
    // The invoice id doesn't exist until BTCPay's create-invoice call
    // returns, so unlike billplz/toyyibpay's signed redirect, the redirect
    // URL can't carry it directly — it carries orderNumber (known up front)
    // instead, and handlePaymentRedirect resolves that back to the invoice id
    // via the order row.
    const invoice = await btcpay.createInvoice({
      btcpayUrl: env.BTCPAY_URL!,
      apiKey: env.BTCPAY_API_KEY!,
      storeId: env.BTCPAY_STORE_ID!,
      amount: params.amount / 100,
      currency: 'MYR',
      orderNumber: params.orderNumber,
      orderId: params.orderId,
      buyerEmail: params.email,
      redirectUrl: `${backendUrl}/api/v1/payments/redirect?gateway=btcpay&orderNumber=${encodeURIComponent(params.orderNumber)}`,
    });
    return { billId: invoice.id, paymentUrl: invoice.checkoutLink, gateway: 'btcpay' };
  },
  // Inbound confirmation for btcpay never comes through here — BTCPay's
  // webhook signature is computed over the RAW request body, which the
  // generic form-encoded /callback route (and this Record<string,string>
  // shape) can't preserve. See modules/webhooks/btcpay-webhook.* instead.
  // Kept as unreachable stubs only to satisfy the shared interface.
  verifyCallback() {
    return false;
  },
  parseCallback() {
    return { billId: '', status: 'pending' };
  },
  buildRedirectUrl(query, verifiedPaid) {
    const frontendUrl = getFrontendUrl();
    return verifiedPaid
      ? `${frontendUrl}/checkout/success`
      : failedUrl(frontendUrl, query.invoiceId && this.billUrl(query.invoiceId));
  },
  async verifyPaid(billId) {
    const invoice = await btcpay.getInvoice(env.BTCPAY_URL!, env.BTCPAY_API_KEY!, env.BTCPAY_STORE_ID!, billId);
    // Only "Settled" counts as paid. "Processing" (on-chain payment seen in
    // the mempool but not yet confirmed) is deliberately NOT treated as paid
    // — an unconfirmed transaction can still be replaced or dropped, and
    // applyPaid() ships the order. Same conservative handling as ToyyibPay's
    // pending status: neither paid nor failed, just wait for the next check.
    if (invoice.status === 'Settled') return { paid: true };
    // BTCPay already separates the two cases we care about: "Invalid" means a
    // payment was seen and rejected (underpaid, or replaced before confirming),
    // while "Expired" means the invoice simply ran out with nothing sent. New /
    // Processing are not final, so they stay undefined rather than being read
    // as an abandon.
    const failureReason =
      invoice.status === 'Invalid'
        ? ('DECLINED' as const)
        : invoice.status === 'Expired'
          ? ('NO_ATTEMPT' as const)
          : undefined;
    return { paid: false, failureReason };
  },
  billUrl(billId) {
    return `${env.BTCPAY_URL}/i/${billId}`;
  },
};

// How long a CHIP purchase stays payable. Matches the reconcile sweep's
// RELEASE_AFTER_MS: past this the order's stock goes back on sale, so the
// purchase must stop taking money at the same moment. due_strict makes CHIP
// itself enforce it (status `expired`), and applyFailed's cancel call is the
// second lock on the same door.
const CHIP_PAYABLE_FOR_S = 2 * 60 * 60;

const chipGateway: PaymentGateway = {
  name: 'chip',
  async createBill(params) {
    const backendUrl = getBackendUrl();
    // Like BTCPay, the purchase id doesn't exist until CHIP answers, so the
    // return URLs carry the order number and handlePaymentRedirect resolves it
    // back to the purchase. CHIP doesn't sign its redirects anyway — the
    // server-side re-query there is the only thing that confirms anything.
    const returnUrl = `${backendUrl}/api/v1/payments/redirect?gateway=chip&orderNumber=${encodeURIComponent(params.orderNumber)}`;
    // CHIP rejects a success_callback with an explicit port (even :443), and
    // can't reach localhost anyway. Locally the redirect and the sweep confirm.
    const callbackUrl = `${backendUrl}/api/v1/payments/chip/callback`;
    const callbackUsable = new URL(callbackUrl).port === '' && callbackUrl.startsWith('https://');

    const purchase = await chip.createPurchase({
      email: params.email!,
      phone: params.phone,
      fullName: params.name,
      amount: params.amount,
      productName: params.description,
      reference: params.orderNumber,
      due: Math.floor(Date.now() / 1000) + CHIP_PAYABLE_FOR_S,
      successRedirect: returnUrl,
      failureRedirect: returnUrl,
      // "Return to seller" on CHIP's page. It doesn't cancel the purchase, so
      // it lands on the same verify-and-route path, which offers the open
      // purchase back as a retry link.
      cancelRedirect: returnUrl,
      successCallback: callbackUsable ? callbackUrl : undefined,
    });

    // A test key on the live site takes test cards and reports them `paid`.
    // Refuse before the customer is ever sent to it.
    if (purchase.is_test && isLiveDeployment()) {
      await chip.cancelPurchase(purchase.id).catch(() => {});
      throw new Error('CHIP returned a TEST purchase on a live deployment — CHIP_SECRET_KEY is a test key');
    }
    if (!purchase.checkout_url) {
      throw new Error(`CHIP purchase ${purchase.id} has no checkout_url (status ${purchase.status})`);
    }
    return { billId: purchase.id, paymentUrl: purchase.checkout_url, gateway: 'chip' };
  },
  // CHIP's success callback is JSON signed over the raw bytes, so it has its
  // own route (POST /api/v1/payments/chip/callback) instead of the generic
  // form-encoded /callback. Unreachable stubs, as for BTCPay.
  verifyCallback() {
    return false;
  },
  parseCallback() {
    return { billId: '', status: 'pending' };
  },
  buildRedirectUrl(query, verifiedPaid) {
    const frontendUrl = getFrontendUrl();
    return verifiedPaid
      ? `${frontendUrl}/checkout/success`
      : failedUrl(frontendUrl, query.purchaseId && this.billUrl(query.purchaseId));
  },
  async verifyPaid(billId) {
    const purchase = await chip.getPurchase(billId);
    return chip.classifyPurchase(purchase, { acceptTest: !isLiveDeployment() });
  },
  async deactivateBill(billId) {
    const purchase = await chip.cancelPurchase(billId);
    return purchase.status === 'cancelled';
  },
  billUrl(billId) {
    // CHIP's hosted checkout lives at gate.chip-in.asia/p/<purchase id>/ —
    // the same URL createBill got back as checkout_url, rebuilt from the id
    // because the URL itself isn't stored on the order.
    return `${new URL(env.CHIP_API_URL).origin}/p/${billId}/`;
  },
};

export function getActiveGateway(gatewayName?: string): PaymentGateway | null {
  const name = gatewayName || 'billplz';
  // A gateway left in sandbox mode takes no real money while cheerfully
  // reporting success, so in production it must not be selectable at all —
  // the `payment_gateway` setting is a dropdown in admin, and flipping it to a
  // gateway whose *_SANDBOX flag was never turned off would silently start
  // shipping orders against fake payments. Refusing here surfaces as "online
  // payment unavailable", which is loud and safe.
  const isProd = isLiveDeployment();

  if (name === 'billplz' && env.BILLPLZ_API_KEY && env.BILLPLZ_COLLECTION_ID) {
    return isProd && env.BILLPLZ_SANDBOX ? null : billplzGateway;
  }
  if (name === 'toyyibpay' && env.TOYYIBPAY_SECRET_KEY && env.TOYYIBPAY_CATEGORY_CODE) {
    return isProd && env.TOYYIBPAY_SANDBOX ? null : toyyibpayGateway;
  }
  // CHIP has no sandbox flag to check here — test vs live is the key itself,
  // and the guard runs per purchase in chipGateway (createBill + verifyPaid).
  if (name === 'chip' && env.CHIP_SECRET_KEY && env.CHIP_BRAND_ID) {
    return chipGateway;
  }
  if (name === 'btcpay' && env.BTCPAY_URL && env.BTCPAY_API_KEY && env.BTCPAY_STORE_ID) {
    return btcpayGateway;
  }
  return null;
}

/**
 * Payment methods that are settled by a gateway rather than by a human.
 *
 * BILLPLZ is the legacy enum name for "paid online through a fiat gateway"
 * (the live one is whichever `payment_gateway` names); CRYPTO is always
 * BTCPay. Anything that used to branch on `=== 'BILLPLZ'` to mean "this is a
 * gateway-backed order" has to go through here instead, or crypto orders drop
 * out of the reconcile sweep and the paid-order lock.
 */
export function isOnlineMethod(method: string): boolean {
  return method === 'BILLPLZ' || method === 'CRYPTO';
}

/**
 * Which gateway settles a given payment method. CRYPTO is pinned to BTCPay and
 * deliberately ignores the `payment_gateway` setting — that setting picks the
 * *fiat* gateway, and crypto is offered alongside it, not instead of it.
 */
export function gatewayNameForMethod(method: string, fiatGateway: string): string {
  return method === 'CRYPTO' ? 'btcpay' : fiatGateway;
}

export function getGatewayByBillId(billId: string, gatewayName?: string): PaymentGateway | null {
  if (gatewayName === 'toyyibpay') return toyyibpayGateway;
  if (gatewayName === 'billplz') return billplzGateway;
  if (gatewayName === 'btcpay') return btcpayGateway;
  if (gatewayName === 'chip') return chipGateway;
  if (billId && billId.length < 20) return toyyibpayGateway;
  return billplzGateway;
}
