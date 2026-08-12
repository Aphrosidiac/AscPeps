import { env } from '../config/env.js';
import * as billplz from './billplz.js';
import * as toyyibpay from './toyyibpay.js';

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
  /** Re-query the gateway for the authoritative paid state of a bill. */
  /**
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

export function getActiveGateway(gatewayName?: string): PaymentGateway | null {
  const name = gatewayName || 'billplz';
  // A gateway left in sandbox mode takes no real money while cheerfully
  // reporting success, so in production it must not be selectable at all —
  // the `payment_gateway` setting is a dropdown in admin, and flipping it to a
  // gateway whose *_SANDBOX flag was never turned off would silently start
  // shipping orders against fake payments. Refusing here surfaces as "online
  // payment unavailable", which is loud and safe.
  //
  // NODE_ENV is deliberately not the signal here: it is unset on the live PM2
  // process, so a NODE_ENV check would silently never fire — exactly the class
  // of bug this guard exists to prevent. Reuse getBackendUrl's convention
  // instead: a non-localhost FRONTEND_URL means this is a real deployment.
  const isProd = !env.FRONTEND_URL.startsWith('http://localhost');

  if (name === 'billplz' && env.BILLPLZ_API_KEY && env.BILLPLZ_COLLECTION_ID) {
    return isProd && env.BILLPLZ_SANDBOX ? null : billplzGateway;
  }
  if (name === 'toyyibpay' && env.TOYYIBPAY_SECRET_KEY && env.TOYYIBPAY_CATEGORY_CODE) {
    return isProd && env.TOYYIBPAY_SANDBOX ? null : toyyibpayGateway;
  }
  return null;
}

export function getGatewayByBillId(billId: string, gatewayName?: string): PaymentGateway | null {
  if (gatewayName === 'toyyibpay') return toyyibpayGateway;
  if (gatewayName === 'billplz') return billplzGateway;
  if (billId && billId.length < 20) return toyyibpayGateway;
  return billplzGateway;
}
