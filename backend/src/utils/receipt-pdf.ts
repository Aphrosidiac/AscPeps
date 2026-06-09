import PDFDocument from 'pdfkit';
import path from 'path';

interface ReceiptItem {
  quantity: number;
  unitPrice: number;
  product: { name: string; code: string };
}

interface ReceiptOrder {
  orderNumber: string;
  createdAt: Date | string;
  customerName: string;
  phone: string;
  email: string | null;
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
  paymentStatus: string;
  paymentRef: string | null;
  status: string;
  trackingNumber: string | null;
  discountCode?: { code: string; discountType: string; discountValue: number } | null;
  items: ReceiptItem[];
}

interface ReceiptSettings {
  receipt_company_name?: string;
  receipt_company_reg?: string;
  receipt_address?: string;
  receipt_phone?: string;
  receipt_email?: string;
  receipt_footer_note?: string;
  business_name?: string;
}

function formatRM(sen: number): string {
  return `RM ${(sen / 100).toFixed(2)}`;
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-MY', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export async function generateReceiptPdf(
  order: ReceiptOrder,
  settings: ReceiptSettings,
): Promise<Buffer> {
  const companyName = settings.receipt_company_name || settings.business_name || 'ASCEND';
  const companyReg = settings.receipt_company_reg || '';
  const companyAddress = settings.receipt_address || '';
  const companyPhone = settings.receipt_phone || '';
  const companyEmail = settings.receipt_email || '';
  const footerNote =
    settings.receipt_footer_note || 'All products are for research and laboratory use only.';

  const logoPath = path.resolve(process.cwd(), 'assets', 'logo.png');

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width - 100; // 50 margin each side
    const leftX = 50;
    const rightX = doc.page.width - 50;

    // === Header: Logo + Company Info ===
    try {
      doc.image(logoPath, leftX, 45, { width: 36 });
    } catch {
      // logo missing — skip
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(companyName, leftX + 44, 50);

    let headerY = 72;
    doc.font('Helvetica').fontSize(8).fillColor('#666666');
    if (companyAddress) {
      doc.text(companyAddress, leftX + 44, headerY);
      headerY += 11;
    }
    const contactParts = [companyPhone, companyEmail].filter(Boolean);
    if (contactParts.length) {
      doc.text(contactParts.join('  |  '), leftX + 44, headerY);
      headerY += 11;
    }
    if (companyReg) {
      doc.text(`Reg: ${companyReg}`, leftX + 44, headerY);
      headerY += 11;
    }

    // === RECEIPT title + order info (right aligned) ===
    doc
      .font('Helvetica-Bold')
      .fontSize(24)
      .fillColor('#000000')
      .text('RECEIPT', leftX, 110, { align: 'right', width: pageWidth });

    doc.font('Helvetica').fontSize(9).fillColor('#444444');
    doc.text(`Order: ${order.orderNumber}`, leftX, 140, { align: 'right', width: pageWidth });
    doc.text(`Date: ${formatDate(order.createdAt)}`, leftX, 153, {
      align: 'right',
      width: pageWidth,
    });
    doc.text(
      `Status: ${order.status} | Payment: ${order.paymentStatus}`,
      leftX,
      166,
      { align: 'right', width: pageWidth },
    );

    // === Divider ===
    doc
      .moveTo(leftX, 188)
      .lineTo(rightX, 188)
      .strokeColor('#dddddd')
      .lineWidth(1)
      .stroke();

    // === Customer Info ===
    let y = 200;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#888888').text('BILL TO', leftX, y);
    y += 16;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text(order.customerName, leftX, y);
    y += 14;
    doc.font('Helvetica').fontSize(9).fillColor('#444444');
    doc.text(order.phone, leftX, y);
    y += 12;
    if (order.email) {
      doc.text(order.email, leftX, y);
      y += 12;
    }
    doc.text(`${order.address}`, leftX, y);
    y += 12;
    doc.text(`${order.city}, ${order.state} ${order.postcode}`, leftX, y);
    y += 24;

    // === Items Table ===
    const colItem = leftX;
    const colQty = leftX + 280;
    const colPrice = leftX + 340;
    const colAmount = rightX;

    // Table header
    doc
      .moveTo(leftX, y)
      .lineTo(rightX, y)
      .strokeColor('#000000')
      .lineWidth(1)
      .stroke();
    y += 8;

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#888888');
    doc.text('ITEM', colItem, y);
    doc.text('QTY', colQty, y, { width: 40, align: 'center' });
    doc.text('PRICE', colPrice, y, { width: 60, align: 'right' });
    doc.text('AMOUNT', colAmount - 70, y, { width: 70, align: 'right' });
    y += 16;

    doc
      .moveTo(leftX, y)
      .lineTo(rightX, y)
      .strokeColor('#dddddd')
      .lineWidth(0.5)
      .stroke();
    y += 8;

    // Table rows
    doc.font('Helvetica').fontSize(9).fillColor('#000000');
    for (const item of order.items) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      doc.font('Helvetica').fontSize(9).fillColor('#000000');
      doc.text(item.product.name, colItem, y, { width: 260 });
      const nameHeight = doc.heightOfString(item.product.name, { width: 260 });

      doc.fontSize(7).fillColor('#888888');
      doc.text(item.product.code, colItem, y + nameHeight, { width: 260 });

      doc.fontSize(9).fillColor('#000000');
      doc.text(String(item.quantity), colQty, y, { width: 40, align: 'center' });
      doc.text(formatRM(item.unitPrice), colPrice, y, { width: 60, align: 'right' });
      doc.text(formatRM(item.unitPrice * item.quantity), colAmount - 70, y, {
        width: 70,
        align: 'right',
      });

      y += Math.max(nameHeight + 14, 22);
    }

    // Table bottom line
    y += 4;
    doc
      .moveTo(leftX, y)
      .lineTo(rightX, y)
      .strokeColor('#000000')
      .lineWidth(1)
      .stroke();
    y += 14;

    // === Totals ===
    const totalsX = colPrice;
    const totalsW = rightX - colPrice;

    doc.font('Helvetica').fontSize(9).fillColor('#444444');
    doc.text('Subtotal', totalsX - 80, y, { width: 80, align: 'right' });
    doc.text(formatRM(order.subtotal), totalsX, y, { width: totalsW, align: 'right' });
    y += 16;

    if (order.discountAmount > 0) {
      const discountLabel = order.discountCode
        ? `Discount (${order.discountCode.code})`
        : 'Discount';
      doc.fillColor('#22863a');
      doc.text(discountLabel, totalsX - 120, y, { width: 120, align: 'right' });
      doc.text(`-${formatRM(order.discountAmount)}`, totalsX, y, {
        width: totalsW,
        align: 'right',
      });
      y += 16;
    }

    doc.fillColor('#444444');
    doc.text('Shipping', totalsX - 80, y, { width: 80, align: 'right' });
    doc.text(
      order.shippingFee ? formatRM(order.shippingFee) : 'Free',
      totalsX,
      y,
      { width: totalsW, align: 'right' },
    );
    y += 4;

    // Total divider
    doc
      .moveTo(totalsX - 80, y + 10)
      .lineTo(rightX, y + 10)
      .strokeColor('#000000')
      .lineWidth(1)
      .stroke();
    y += 20;

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000');
    doc.text('Total', totalsX - 80, y, { width: 80, align: 'right' });
    doc.text(formatRM(order.total), totalsX, y, { width: totalsW, align: 'right' });
    y += 30;

    // === Payment Info ===
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#888888').text('PAYMENT', leftX, y);
    y += 14;
    doc.font('Helvetica').fontSize(9).fillColor('#444444');
    const payMethod =
      order.paymentMethod === 'WHATSAPP'
        ? 'Manual Transfer (WhatsApp)'
        : `Online (${order.paymentGateway || 'Billplz'})`;
    doc.text(`Method: ${payMethod}`, leftX, y);
    y += 13;
    if (order.paymentRef) {
      doc.text(`Reference: ${order.paymentRef}`, leftX, y);
      y += 13;
    }

    // === Tracking ===
    if (
      order.trackingNumber &&
      (order.status === 'SHIPPED' || order.status === 'DELIVERED')
    ) {
      y += 6;
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#888888').text('SHIPPING', leftX, y);
      y += 14;
      doc.font('Helvetica').fontSize(9).fillColor('#444444');
      doc.text(`Tracking: ${order.trackingNumber}`, leftX, y);
      y += 13;
    }

    // === Footer ===
    const footerY = doc.page.height - 70;
    doc
      .moveTo(leftX, footerY)
      .lineTo(rightX, footerY)
      .strokeColor('#dddddd')
      .lineWidth(0.5)
      .stroke();

    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#999999')
      .text(footerNote, leftX, footerY + 10, { align: 'center', width: pageWidth });
    doc.text('Thank you for your purchase.', leftX, footerY + 22, {
      align: 'center',
      width: pageWidth,
    });

    doc.end();
  });
}
