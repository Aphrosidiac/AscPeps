import { env } from '../config/env.js';

interface WhatsAppOrderItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

interface WhatsAppOrderData {
  orderNumber: string;
  items: WhatsAppOrderItem[];
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  total: number;
  customerName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postcode: string;
}

export function buildWhatsAppUrl(data: WhatsAppOrderData): string {
  const itemLines = data.items
    .map((item) => `${item.quantity}x ${item.name} - RM${(item.unitPrice / 100).toFixed(2)}`)
    .join('\n');

  let breakdown = `*Subtotal: RM${(data.subtotal / 100).toFixed(2)}*`;
  if (data.shippingFee > 0) breakdown += `\n*Shipping: RM${(data.shippingFee / 100).toFixed(2)}*`;
  if (data.discountAmount > 0) breakdown += `\n*Discount: -RM${(data.discountAmount / 100).toFixed(2)}*`;
  breakdown += `\n*Total: RM${(data.total / 100).toFixed(2)}*`;

  const message = `*Ascend MY Order #${data.orderNumber}*

*Items:*
${itemLines}

${breakdown}

*Customer:* ${data.customerName}
*Phone:* ${data.phone}
*Address:* ${data.address}, ${data.city}, ${data.state} ${data.postcode}`;

  const encoded = encodeURIComponent(message);
  return `https://wa.me/${env.WHATSAPP_NUMBER}?text=${encoded}`;
}
