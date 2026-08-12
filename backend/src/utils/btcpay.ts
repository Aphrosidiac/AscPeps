import axios from 'axios';
import crypto from 'crypto';

interface CreateInvoiceParams {
  btcpayUrl: string;
  apiKey: string;
  storeId: string;
  amount: number; // major units (RM), NOT sen
  currency: string;
  orderNumber: string;
  orderId: string;
  buyerEmail?: string;
  redirectUrl: string;
}

interface InvoiceResponse {
  id: string;
  checkoutLink: string;
  // New | Processing | Settled | Expired | Invalid
  status: string;
}

export async function createInvoice(params: CreateInvoiceParams): Promise<InvoiceResponse> {
  const { data } = await axios.post<InvoiceResponse>(
    `${params.btcpayUrl}/api/v1/stores/${params.storeId}/invoices`,
    {
      amount: params.amount.toFixed(2),
      currency: params.currency,
      metadata: {
        orderId: params.orderId,
        orderNumber: params.orderNumber,
        buyerEmail: params.buyerEmail,
      },
      checkout: { redirectURL: params.redirectUrl },
    },
    {
      headers: { Authorization: `token ${params.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    }
  );
  return data;
}

export async function getInvoice(
  btcpayUrl: string,
  apiKey: string,
  storeId: string,
  invoiceId: string
): Promise<InvoiceResponse> {
  const { data } = await axios.get<InvoiceResponse>(
    `${btcpayUrl}/api/v1/stores/${storeId}/invoices/${invoiceId}`,
    { headers: { Authorization: `token ${apiKey}` }, timeout: 30000 }
  );
  return data;
}

/**
 * BTCPay signs webhook deliveries as `sha256=<hmac-hex>` of the RAW request
 * body (not the parsed JSON — key order/whitespace would drift the hash).
 * Mirrors the official Node.js example in BTCPay's docs exactly.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
