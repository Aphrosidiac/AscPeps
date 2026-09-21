/**
 * The internal order summary — an order rendered in shadow SKU vocabulary.
 *
 * This is NOT a receipt and is built so it cannot be mistaken for one. The
 * customer's receipt (utils/receipt-pdf.ts) remains the record of the sale;
 * this sits beside it, never over it. Three things enforce that, and they are
 * not configurable:
 *
 *   - a fixed banner naming the document and saying the descriptions are
 *     generalised,
 *   - the real order number printed on it, so any copy reduces back to the
 *     real order,
 *   - a footer pointing at the customer receipt as the authoritative record.
 *
 * It also deliberately does not reuse the receipt's logo/letterhead block. Two
 * documents for one order that look alike is how the wrong one ends up in
 * front of the wrong person.
 */

import PDFDocument from 'pdfkit';
import type { ResolvedShadowLine } from './shadow-sku.js';

interface SummaryOrder {
  orderNumber: string;
  createdAt: Date | string;
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  /** Why a hand-keyed discount was given. Internal document, so it is shown. */
  discountNote?: string | null;
  total: number;
  status: string;
  paymentStatus: string;
}

function formatRM(sen: number): string {
  return `RM ${(sen / 100).toFixed(2)}`;
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-MY', { year: 'numeric', month: 'long', day: 'numeric' });
}

export async function generateInternalSummaryPdf(
  order: SummaryOrder,
  lines: ResolvedShadowLine[],
  businessName: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const leftX = 50;
    const rightX = doc.page.width - 50;
    const pageWidth = doc.page.width - 100;

    // === Fixed banner. Not a parameter, not a setting. =====================
    doc.rect(leftX, 45, pageWidth, 46).fillColor('#f4f4f5').fill();
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#18181b')
      .text('INTERNAL SUMMARY — GENERALISED ITEM DESCRIPTIONS', leftX + 12, 57, {
        width: pageWidth - 24,
      });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#52525b')
      .text('Not a receipt. Not valid as a record of sale.', leftX + 12, 74, {
        width: pageWidth - 24,
      });

    // === Order identity ====================================================
    let y = 110;
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#000000').text(businessName, leftX, y);
    doc.font('Helvetica').fontSize(9).fillColor('#444444');
    doc.text(`Order: ${order.orderNumber}`, leftX, y, { align: 'right', width: pageWidth });
    doc.text(`Date: ${formatDate(order.createdAt)}`, leftX, y + 13, {
      align: 'right',
      width: pageWidth,
    });
    doc.text(`Status: ${order.status} | Payment: ${order.paymentStatus}`, leftX, y + 26, {
      align: 'right',
      width: pageWidth,
    });

    y += 52;
    doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#dddddd').lineWidth(1).stroke();

    // === Lines =============================================================
    y += 16;
    const colItem = leftX;
    const colQty = leftX + 300;
    const colPrice = leftX + 360;
    const colAmount = rightX;

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#888888');
    doc.text('ITEM', colItem, y);
    doc.text('QTY', colQty, y, { width: 40, align: 'center' });
    doc.text('UNIT', colPrice, y, { width: 60, align: 'right' });
    doc.text('AMOUNT', colAmount - 70, y, { width: 70, align: 'right' });

    y += 14;
    doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor('#eeeeee').lineWidth(1).stroke();
    y += 10;

    for (const line of lines) {
      doc.font('Helvetica').fontSize(10).fillColor('#000000');
      doc.text(line.name, colItem, y, { width: 260 });
      const nameHeight = doc.heightOfString(line.name, { width: 260 });

      // The shadow code, never the real variant.code.
      doc.font('Helvetica').fontSize(8).fillColor('#888888');
      doc.text(line.code, colItem, y + nameHeight, { width: 260 });

      doc.font('Helvetica').fontSize(10).fillColor('#000000');
      doc.text(String(line.quantity), colQty, y, { width: 40, align: 'center' });
      doc.text(formatRM(line.unitPrice), colPrice, y, { width: 60, align: 'right' });
      doc.text(formatRM(line.unitPrice * line.quantity), colAmount - 70, y, {
        width: 70,
        align: 'right',
      });

      y += Math.max(nameHeight + 14, 22);
    }

    // === Totals — identical to the real order, by construction =============
    y += 6;
    doc.moveTo(colQty, y).lineTo(rightX, y).strokeColor('#eeeeee').lineWidth(1).stroke();
    y += 10;

    const totalRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9);
      doc.fillColor(bold ? '#000000' : '#444444');
      doc.text(label, colPrice - 90, y, { width: 150, align: 'right' });
      doc.text(value, colAmount - 70, y, { width: 70, align: 'right' });
      y += bold ? 18 : 14;
    };

    totalRow('Subtotal', formatRM(order.subtotal));
    if (order.discountAmount > 0) {
      totalRow(order.discountNote ? `Discount (${order.discountNote})` : 'Discount', `-${formatRM(order.discountAmount)}`);
    }
    if (order.shippingFee > 0) totalRow('Shipping', formatRM(order.shippingFee));
    totalRow('Total', formatRM(order.total), true);

    // === Fixed footer ======================================================
    // Sits below the totals but never past the bottom margin, and high enough
    // that the three-line note below still fits — placing it lower makes the
    // note wrap onto a second, otherwise-empty page.
    const footerY = Math.max(y + 24, doc.page.height - 112);
    doc.moveTo(leftX, footerY).lineTo(rightX, footerY).strokeColor('#eeeeee').lineWidth(1).stroke();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#71717a')
      .text(
        `Item descriptions on this sheet are generalised. The record of sale for order ${order.orderNumber} is the customer receipt, which lists the products as sold. Totals on both are the same.`,
        leftX,
        footerY + 10,
        { width: pageWidth },
      );

    doc.end();
  });
}
