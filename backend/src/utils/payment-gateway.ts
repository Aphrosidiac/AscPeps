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
  paid: boolean;
  orderRef?: string;
}

export interface PaymentGateway {
  name: string;
  createBill(params: CreateBillParams): Promise<BillResult>;
  verifyCallback(body: Record<string, string>): boolean;
  parseCallback(body: Record<string, string>): CallbackResult;
  buildRedirectUrl(query: Record<string, string>): string;
}

function getBackendUrl(): string {
  return env.FRONTEND_URL.startsWith('http://localhost')
    ? `http://localhost:${env.PORT}`
    : 'https://ascendpeptides.my';
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
    return {
      billId: body.id,
      paid: body.paid === 'true' && body.state === 'paid',
      orderRef: body.id,
    };
  },
  buildRedirectUrl(query) {
    const valid = billplz.verifyRedirectSignature(query);
    const paid = query['billplz[paid]'] === 'true';
    const frontendUrl = env.FRONTEND_URL.startsWith('http://localhost')
      ? env.FRONTEND_URL
      : 'https://ascendpeptides.my';
    return valid && paid
      ? `${frontendUrl}/checkout/success`
      : `${frontendUrl}/checkout/failed`;
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
    return {
      billId: body.billcode,
      paid: body.status === '1',
      orderRef: body.order_id,
    };
  },
  buildRedirectUrl(query) {
    const paid = query.status_id === '1';
    const frontendUrl = env.FRONTEND_URL.startsWith('http://localhost')
      ? env.FRONTEND_URL
      : 'https://ascendpeptides.my';
    return paid
      ? `${frontendUrl}/checkout/success`
      : `${frontendUrl}/checkout/failed`;
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
