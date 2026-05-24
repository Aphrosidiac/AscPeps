import { env } from '../config/env.js';

interface WhatsAppOrderItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

interface WhatsAppOrderData {
  orderNumber: string;
  items: WhatsAppOrderItem[];
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

  const message = `*ASCEND Order #${data.orderNumber}*

*Items:*
${itemLines}

*Total: RM${(data.total / 100).toFixed(2)}*

*Customer:* ${data.customerName}
*Phone:* ${data.phone}
*Address:* ${data.address}, ${data.city}, ${data.state} ${data.postcode}`;

  const encoded = encodeURIComponent(message);
  return `https://wa.me/${env.WHATSAPP_NUMBER}?text=${encoded}`;
}
