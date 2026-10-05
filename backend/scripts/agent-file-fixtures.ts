/**
 * Real files of every type the assistant reads, built in memory so the tests
 * need nothing checked in. Each carries the same recognisable facts (a
 * supplier, an invoice number, a total) so a test can assert that the
 * extracted text actually contains them, not merely that something came out.
 */
import PDFDocument from 'pdfkit';
import JSZip from 'jszip';
import sharp from 'sharp';
import * as XLSX from 'xlsx';

export const FACTS = { supplier: 'Zuwa Trading', invoice: 'INV-77314', total: '1,284.50', sku: 'BPC-157 10mg' };

function pdfFrom(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    draw(doc);
    doc.end();
  });
}

export function textPdf(): Promise<Buffer> {
  return pdfFrom((doc) => {
    doc.fontSize(18).text(`${FACTS.supplier} — Invoice ${FACTS.invoice}`);
    doc.moveDown().fontSize(11).text(`Item: ${FACTS.sku} x 20`);
    doc.text(`Total due: RM ${FACTS.total}`);
    doc.addPage().text('Page two: payment to Maybank 5140 1234 5678, due 15 Oct 2026.');
  });
}

// A picture of a page inside a PDF with no text layer — what a phone scanner
// app produces.
export async function picture(lines: string[] = [`${FACTS.supplier}`, `Invoice ${FACTS.invoice}`, `${FACTS.sku} x 20`, `Total RM ${FACTS.total}`]): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="900"><rect width="100%" height="100%" fill="#fff"/>${lines
    .map((l, i) => `<text x="80" y="${160 + i * 110}" font-family="Helvetica, Arial" font-size="64" fill="#111">${l.replace(/&/g, '&amp;')}</text>`)
    .join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function scannedPdf(): Promise<Buffer> {
  const png = await picture();
  return pdfFrom((doc) => {
    doc.image(png, 40, 40, { width: 515 });
  });
}

export async function docx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const p = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const cell = (t: string) => `<w:tc>${p(t)}</w:tc>`;
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${p(`${FACTS.supplier} quotation ${FACTS.invoice}`)}<w:tbl><w:tr>${cell('Item')}${cell('Qty')}${cell('Amount')}</w:tr><w:tr>${cell(FACTS.sku)}${cell('20')}${cell(`RM ${FACTS.total}`)}</w:tr></w:tbl>${p('Valid for 14 days.')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export function xlsx(bookType: 'xlsx' | 'xls' | 'ods' = 'xlsx'): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Supplier', 'SKU', 'Qty', 'Total'], [FACTS.supplier, FACTS.sku, 20, FACTS.total], ['Chris', 'TB-500 5mg', 10, '600.00']]), 'Purchases');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Invoice'], [FACTS.invoice]]), 'Refs');
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
}

export function csv(): Buffer {
  return Buffer.from(`Supplier,SKU,Qty,Total\n${FACTS.supplier},${FACTS.sku},20,"${FACTS.total}"\n`);
}

export async function pptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  const slide = (lines: string[]) => `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${lines.map((l) => `<p:sp><p:txBody><a:p><a:r><a:t>${l}</a:t></a:r></a:p></p:txBody></p:sp>`).join('')}</p:spTree></p:cSld></p:sld>`;
  zip.file('ppt/slides/slide1.xml', slide([`Q4 plan — ${FACTS.supplier}`, 'Restock BPC']));
  zip.file('ppt/slides/slide2.xml', slide([`Budget RM ${FACTS.total}`]));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export function html(): Buffer {
  return Buffer.from(`<html><head><style>p{}</style></head><body><h1>${FACTS.supplier}</h1><table><tr><th>Ref</th><th>Total</th></tr><tr><td>${FACTS.invoice}</td><td>RM ${FACTS.total}</td></tr></table></body></html>`);
}

export async function heic(): Promise<Buffer | null> {
  // sharp can only write HEIF with a libheif build that has an encoder; when it
  // cannot, the HEIC case is skipped rather than faked.
  try {
    return await sharp(await picture()).heif({ compression: 'hevc' }).toBuffer();
  } catch {
    return null;
  }
}
