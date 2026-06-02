import { env } from '../config/env.js';
import * as billplz from './billplz.js';
import * as toyyibpay from './toyyibpay.js';

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
  buildRedirectUrl(query: Record<string, string>): string;
  /** Re-query the gateway for the authoritative paid state of a bill. */
  verifyPaid(billId: string): Promise<{ paid: boolean; amount?: number }>;
}

function getBackendUrl(): string {
  if (env.FRONTEND_URL.startsWith('http://localhost')) return `http://localhost:${env.PORT}`;
  const url = new URL(env.FRONTEND_URL);
  return `https://${url.hostname}`;
}

function getFrontendUrl(): string {
  return env.FRONTEND_URL;
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
  buildRedirectUrl(query) {
    const valid = billplz.verifyRedirectSignature(query);
    const paid = query['billplz[paid]'] === 'true';
    const frontendUrl = getFrontendUrl();
    return valid && paid
      ? `${frontendUrl}/checkout/success`
      : `${frontendUrl}/checkout/failed`;
  },
  async verifyPaid(billId) {
    const bill = await billplz.getBill(billId);
    return { paid: bill.paid, amount: bill.paid_amount };
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
    const host = env.TOYYIBPAY_SANDBOX ? 'https://dev.toyyibpay.com' : 'https://toyyibpay.com';
    return { billId: billCode, paymentUrl: `${host}/${billCode}`, gateway: 'toyyibpay' };
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
    // Callback amount may arrive as RM ("1.00") or sen ("100"); normalise to sen.
    let amount: number | undefined;
    if (body.amount != null && body.amount !== '') {
      amount = body.amount.includes('.')
        ? Math.round(parseFloat(body.amount) * 100)
        : parseInt(body.amount, 10);
    }
    return { billId: body.billcode, status, amount, orderRef: body.order_id };
  },
  buildRedirectUrl(query) {
    const paid = query.status_id === '1' && !!query.billcode;
    const frontendUrl = getFrontendUrl();
    return paid
      ? `${frontendUrl}/checkout/success`
      : `${frontendUrl}/checkout/failed`;
  },
  async verifyPaid(billId) {
    return toyyibpay.getBillTransactions(billId, env.TOYYIBPAY_SECRET_KEY!);
  },
};

export function getActiveGateway(gatewayName?: string): PaymentGateway | null {
  const name = gatewayName || 'billplz';

  if (name === 'billplz' && env.BILLPLZ_API_KEY && env.BILLPLZ_COLLECTION_ID) {
    return billplzGateway;
  }
  if (name === 'toyyibpay' && env.TOYYIBPAY_SECRET_KEY && env.TOYYIBPAY_CATEGORY_CODE) {
    return toyyibpayGateway;
  }
  return null;
}

export function getGatewayByBillId(billId: string, gatewayName?: string): PaymentGateway | null {
  if (gatewayName === 'toyyibpay') return toyyibpayGateway;
  if (gatewayName === 'billplz') return billplzGateway;
  if (billId && billId.length < 20) return toyyibpayGateway;
  return billplzGateway;
}
