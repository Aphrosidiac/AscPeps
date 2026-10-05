import sharp from 'sharp';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { extractText, getDocumentProxy } from 'unpdf';
import { env } from '../../../config/env.js';
import { readImage } from './vision.js';
import type { SniffedType } from '../../../utils/agent-media-store.js';

// Turning a file into text the assistant can work from.
//
// Local parsing first, always: a PDF with a text layer, a Word document, a
// spreadsheet or a slide deck is read on this box, for free, in milliseconds,
// and exactly — no model paraphrases an invoice total on the way through.
// A model is only involved where there is no text to parse: a photo (the
// vision model, as before) and a scanned PDF (OCR through OpenRouter's
// file-parser, $0.60 per 1,000 pages).
//
// Whatever is read is returned in full and stored once on the AgentMedia row.
// How much of it the model sees at a time is the caller's decision (see
// media.ts), not this file's.

export interface Extraction {
  text: string;
  method: 'pdf-text' | 'pdf-ocr' | 'vision' | 'docx' | 'sheet' | 'pptx' | 'text';
  pages?: number;
  costUsd: number;
  model?: string;
}

export class UnreadableFile extends Error {}

// Enough for a year of bank statements; a file that reads to more than this is
// a data dump, and the operator is told it was cut.
export const MAX_TEXT_CHARS = 1_000_000;
// A scanned PDF beyond this many pages is not OCR'd whole — the cost is still
// small, but a 300-page scan is never what an operator meant to send a chat
// assistant, and it would hold the turn for minutes.
const MAX_OCR_PAGES = 40;
// Below this many characters per page a PDF has no real text layer: it is a
// scan, or a photo saved as PDF, and needs OCR.
const SCANNED_CHARS_PER_PAGE = 40;

export async function extractFile(bytes: Buffer, type: SniffedType, fileName: string): Promise<Extraction> {
  switch (type.family) {
    case 'image':
      return readPicture(bytes, type.mime);
    case 'pdf':
      return readPdf(bytes, fileName);
    case 'docx':
      return readDocx(bytes);
    case 'sheet':
      return readSheet(bytes);
    case 'pptx':
      return readPptx(bytes);
    case 'text':
      return { text: cap(type.mime === 'text/html' ? htmlToText(bytes.toString('utf8')) : bytes.toString('utf8')), method: 'text', costUsd: 0 };
    default:
      throw new UnreadableFile(`a ${type.ext.toUpperCase() || 'binary'} file is not something I can read — PDF, Word, Excel/CSV, PowerPoint, text and pictures are`);
  }
}

// ------------------------------------------------------------------ pictures

// Vision models take JPEG, PNG, WebP and GIF. An iPhone HEIC, an AVIF or a
// TIFF is converted first, and anything huge is brought down to a size that
// still reads small print — a 48 MP photo costs far more tokens than it adds.
async function readPicture(bytes: Buffer, mime: string): Promise<Extraction> {
  let image = bytes;
  let mimeType = mime;
  const meta = await sharp(bytes).metadata().catch(() => null);
  const tooBig = (meta?.width ?? 0) > 2400 || (meta?.height ?? 0) > 2400;
  if (tooBig || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime)) {
    try {
      image = await sharp(bytes, { failOn: 'none' })
        .rotate()
        .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 88 })
        .toBuffer();
    } catch {
      // The prebuilt sharp decodes AVIF but not HEIC (the HEVC codec is not
      // shipped with it). WhatsApp converts an iPhone photo sent the normal
      // way, so this only happens when one is sent "as a file".
      throw new UnreadableFile(
        mime === 'image/heic'
          ? 'it is an iPhone HEIC photo sent as a file, which I cannot open — send it as a normal photo, or a screenshot of it'
          : `the picture (${mime}) could not be opened — send it as a normal photo or a screenshot`
      );
    }
    mimeType = 'image/jpeg';
  }
  const reading = await readImage({ mimeType, base64: image.toString('base64') });
  return { text: reading.text, method: 'vision', costUsd: reading.costUsd, model: reading.model };
}

// ---------------------------------------------------------------------- PDF

async function readPdf(bytes: Buffer, fileName: string): Promise<Extraction> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (err: any) {
    if (err?.name === 'PasswordException') throw new UnreadableFile('the PDF is password-protected — send it without the password, or a screenshot of the page');
    throw new UnreadableFile(`the PDF is damaged or not really a PDF (${err?.message ?? 'parse failed'})`);
  }
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((t) => t.replace(/[ \t]+\n/g, '\n').trim());
    const chars = pages.reduce((n, p) => n + p.length, 0);
    if (chars / Math.max(totalPages, 1) >= SCANNED_CHARS_PER_PAGE) {
      return { text: cap(withPageMarkers(pages)), method: 'pdf-text', pages: totalPages, costUsd: 0 };
    }
    if (totalPages > MAX_OCR_PAGES) {
      throw new UnreadableFile(`the PDF is a scan of ${totalPages} pages — too long to read through OCR here (the limit is ${MAX_OCR_PAGES}). Send the pages that matter, or screenshots of them`);
    }
    return { ...(await ocrPdf(bytes, fileName)), pages: totalPages };
  } finally {
    // Frees pdf.js's worker-side state; the proxy unpdf hands back has had it
    // under both names across versions.
    const proxy = pdf as unknown as { destroy?: () => Promise<void>; cleanup?: () => Promise<void> };
    await (proxy.destroy ?? proxy.cleanup)?.call(proxy).catch(() => {});
  }
}

function withPageMarkers(pages: string[]): string {
  if (pages.length === 1) return pages[0];
  return pages.map((p, i) => `--- Page ${i + 1} ---\n${p}`).join('\n\n');
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const OCR_PROMPT = `The attached PDF has been converted to text for you. Reproduce that text exactly, page by page, starting each page with a line "--- Page N ---". Keep every name, number, amount, date and reference exactly as written and keep tables as rows separated by " | ". Do not summarise, correct, translate or add anything. Plain text only.`;

// A scanned PDF goes to OpenRouter with the file-parser plugin on its
// mistral-ocr engine. The parsed text is what we want; a small model is asked
// to hand it back verbatim because that is how the plugin's output reaches us.
async function ocrPdf(bytes: Buffer, fileName: string): Promise<Extraction> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new UnreadableFile('the PDF is a scan and OCR needs OpenRouter, which is not configured');
  const model = env.AGENT_VISION_MODEL;
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://ascendpeptides.my',
      'X-Title': 'Ascend MY Admin Agent',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            { type: 'file', file: { filename: fileName || 'document.pdf', file_data: `data:application/pdf;base64,${bytes.toString('base64')}` } },
          ],
        },
      ],
      plugins: [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }],
      max_tokens: 16_000,
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(150_000),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new UnreadableFile(`OCR failed: ${String(json?.error?.message ?? `OpenRouter returned ${res.status}`).split(key).join('••••')}`);
  const text = String(json?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new UnreadableFile('OCR found no text in the PDF');
  const truncated = json?.choices?.[0]?.finish_reason === 'length';
  return {
    text: cap(truncated ? `${text}\n\n[OCR output was cut off here — the rest of the document was not read]` : text),
    method: 'pdf-ocr',
    costUsd: Number(json?.usage?.cost ?? 0),
    model: String(json?.model ?? model),
  };
}

// --------------------------------------------------------------------- Word

async function readDocx(bytes: Buffer): Promise<Extraction> {
  try {
    // Through HTML rather than extractRawText: raw text flattens a table into
    // one cell per line, and an invoice's line items are a table.
    const { value } = await mammoth.convertToHtml({ buffer: bytes });
    return { text: cap(htmlToText(value)), method: 'docx', costUsd: 0 };
  } catch (err: any) {
    throw new UnreadableFile(`the Word file could not be opened (${err?.message ?? 'parse failed'})`);
  }
}

// -------------------------------------------------------------- spreadsheets

// Every sheet, every non-empty row, cells separated by " | ". Dates come out
// as dates and numbers as they were typed (formatted text where the sheet
// has a format, so "RM 1,200.00" stays that rather than 1200).
function readSheet(bytes: Buffer): Extraction {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'buffer', cellDates: true, dense: true });
  } catch (err: any) {
    throw new UnreadableFile(`the spreadsheet could not be opened (${err?.message ?? 'parse failed'})`);
  }
  const blocks: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    // Formatted text per cell, joined by hand: sheet_to_csv quotes any cell
    // containing the separator's space, which turned every product name into
    // "\"BPC-157 10mg\"".
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false, dateNF: 'yyyy-mm-dd' });
    const rows = grid
      .map((row) => row.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim()))
      .filter((row) => row.some(Boolean))
      .map((row) => {
        let end = row.length;
        while (end > 0 && !row[end - 1]) end--;
        return row.slice(0, end).join(' | ');
      });
    if (!rows.length) continue;
    blocks.push(`--- Sheet "${name}" (${rows.length} row${rows.length === 1 ? '' : 's'}) ---\n${rows.join('\n')}`);
  }
  if (!blocks.length) throw new UnreadableFile('the spreadsheet is empty');
  return { text: cap(blocks.join('\n\n')), method: 'sheet', pages: wb.SheetNames.length, costUsd: 0 };
}

// --------------------------------------------------------------- PowerPoint

async function readPptx(bytes: Buffer): Promise<Extraction> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (err: any) {
    throw new UnreadableFile(`the PowerPoint file could not be opened (${err?.message ?? 'parse failed'})`);
  }
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const slides: string[] = [];
  for (const [i, f] of slideFiles.entries()) {
    const xml = await zip.file(f)!.async('string');
    // One line per paragraph (<a:p>), the runs (<a:t>) inside it joined.
    const paras = [...xml.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)]
      .map((p) => [...p[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => decodeEntities(t[1])).join(''))
      .filter((t) => t.trim());
    slides.push(`--- Slide ${i + 1} ---\n${paras.join('\n')}`);
  }
  if (!slides.length) throw new UnreadableFile('the PowerPoint file has no slides');
  return { text: cap(slides.join('\n\n')), method: 'pptx', pages: slides.length, costUsd: 0 };
}

// -------------------------------------------------------------------- shared

function cap(text: string): string {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
  if (clean.length <= MAX_TEXT_CHARS) return clean;
  return `${clean.slice(0, MAX_TEXT_CHARS)}\n\n[The file continues, but only the first ${MAX_TEXT_CHARS.toLocaleString('en')} characters were kept.]`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * HTML to readable text, keeping the structure that carries meaning: table
 * rows as "a | b | c", headings and list items on their own lines. Written
 * for mammoth's output and for the plain HTML files people send — both are
 * simple, well-formed markup, so a parser would add a dependency and nothing
 * else.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
      // A cell's own paragraphs are one line of that cell, not new lines of
      // the page — Word puts every cell's text in a <p>.
      .replace(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi, (_m, tag, attrs, inner: string) =>
        `<${tag}${attrs}>${inner.replace(/<\/?(p|div)\b[^>]*>/gi, ' ').replace(/<br\s*\/?>/gi, ' ')}</${tag}>`
      )
      .replace(/<\/(td|th)>\s*/gi, ' | ')
      .replace(/<tr\b[^>]*>/gi, '\n')
      .replace(/ \| (?=\s*<\/tr>)/gi, '')
      .replace(/<h([1-6])\b[^>]*>/gi, (_m, n) => `\n\n${'#'.repeat(Number(n))} `)
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|table|ul|ol)>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').replace(/\s*\|\s*$/, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
