// Shared email chrome: table-based layout with inline CSS only (the lowest
// common denominator email clients actually render), black/white ASCEND
// branding with a plain-text wordmark — no remote images, which most clients
// block by default anyway.

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Same sen-to-RM formatting as receipt-pdf.ts — all money is stored in sen.
export function formatRM(sen: number): string {
  return `RM ${(sen / 100).toFixed(2)}`;
}

export function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-MY', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Order shape both templates render — the worker's include (items with
// variant + parent product) satisfies this, as does the admin/receipt include.
export interface EmailOrderItem {
  quantity: number;
  unitPrice: number;
  variant: { size: string | null; product: { name: string } };
}

export interface EmailOrder {
  orderNumber: string;
  createdAt: Date | string;
  customerName: string;
  address: string;
  city: string;
  state: string;
  postcode: string;
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  total: number;
  paymentMethod: string;
  paymentGateway: string | null;
  discountCode?: { code: string } | null;
  items: EmailOrderItem[];
}

// Same composition rule as utils/product-addons.ts getVariantDisplayName —
// duplicated here (one line) to keep the emails module display-only.
function itemDisplayName(item: EmailOrderItem): string {
  const { product } = item.variant;
  return item.variant.size ? `${product.name} ${item.variant.size}` : product.name;
}

const cellStyle = 'padding:8px 0;border-bottom:1px solid #eeeeee;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#111111;';
const totalRow = (label: string, value: string, bold = false) => `
            <tr>
              <td style="padding:4px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${bold ? '#000000' : '#555555'};${bold ? 'font-weight:bold;font-size:15px;padding-top:8px;' : ''}">${label}</td>
              <td align="right" style="padding:4px 0;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${bold ? '#000000' : '#555555'};${bold ? 'font-weight:bold;font-size:15px;padding-top:8px;' : ''}">${value}</td>
            </tr>`;

// Item table + totals + shipping address — the block shared by the order
// confirmation and payment receipt.
export function renderOrderSummary(order: EmailOrder): string {
  const itemRows = order.items
    .map(
      (item) => `
            <tr>
              <td style="${cellStyle}">${escapeHtml(itemDisplayName(item))}</td>
              <td align="center" style="${cellStyle}">${item.quantity}</td>
              <td align="right" style="${cellStyle}">${formatRM(item.unitPrice * item.quantity)}</td>
            </tr>`
    )
    .join('');

  const discountLabel = order.discountCode
    ? `Discount (${escapeHtml(order.discountCode.code)})`
    : 'Discount';

  return `
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:8px 0;border-bottom:2px solid #000000;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1px;color:#888888;">ITEM</td>
              <td align="center" style="padding:8px 0;border-bottom:2px solid #000000;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1px;color:#888888;">QTY</td>
              <td align="right" style="padding:8px 0;border-bottom:2px solid #000000;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1px;color:#888888;">AMOUNT</td>
            </tr>${itemRows}
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">${totalRow('Subtotal', formatRM(order.subtotal))}${
            order.discountAmount > 0 ? totalRow(discountLabel, `-${formatRM(order.discountAmount)}`) : ''
          }${totalRow('Shipping', order.shippingFee ? formatRM(order.shippingFee) : 'Free')}${totalRow('Total', formatRM(order.total), true)}
          </table>
          <p style="margin:24px 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1px;color:#888888;">SHIPPING ADDRESS</p>
          <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#555555;">
            ${escapeHtml(order.customerName)}<br>
            ${escapeHtml(order.address)}<br>
            ${escapeHtml(order.city)}, ${escapeHtml(order.state)} ${escapeHtml(order.postcode)}
          </p>`;
}

// Mirrors the disclaimer used on the receipt PDF and site footer.
const DISCLAIMER = 'All products are for research and laboratory use only.';

export function renderLayout(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f4f4f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:94%;background-color:#ffffff;border:1px solid #e5e5e5;">
        <tr>
          <td style="background-color:#000000;padding:24px 32px;">
            <span style="font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:bold;letter-spacing:6px;color:#ffffff;">ASCEND</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#111111;">
${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e5e5;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:#999999;text-align:center;">
            ${DISCLAIMER}<br>
            <a href="https://ascendpeptides.my" style="color:#999999;text-decoration:underline;">ascendpeptides.my</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
