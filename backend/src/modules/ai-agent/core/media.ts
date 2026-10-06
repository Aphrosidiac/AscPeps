import type { FastifyInstance } from 'fastify';
import type { AgentMedia } from '@prisma/client';
import { readFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import * as XLSX from 'xlsx';
import { env } from '../../../config/env.js';
import {
  cleanFileName,
  readAgentMedia,
  sha256,
  sniffType,
  writeAgentMedia,
  deleteAgentMedia,
} from '../../../utils/agent-media-store.js';
import { documentPath } from '../../../utils/document-store.js';
import { adminGetReceiptPdf } from '../../orders/receipt.controller.js';
import { runReadOnlyQuery, timezoneWarning } from '../tools/reports.tools.js';
import { toMalaysiaIso } from '../tool-kit.js';
import { sendWhatsAppFile, targetFromChatKey } from '../../../utils/whatsapp-send.js';
import { extractFile, UnreadableFile } from './extract.js';
import type { Attachment } from './run.js';

// Files in and out of the assistant.
//
// IN: the worker relays a file as base64; it is stored privately, identified
// from its bytes, read ONCE (see extract.ts) and becomes an Attachment on the
// operator's message. The model sees the opening of the text inline and pages
// through the rest with read_attachment — a 30-page statement does not have
// to fit in one message, and it is never parsed or OCR'd twice.
//
// OUT: a tool names what to send (a filed document, an order's receipt, a
// product photo, a file from earlier in the conversation, a spreadsheet from
// a query); the bytes are produced here, stored as an outbound AgentMedia row
// for the audit and the dashboard, and handed to the WhatsApp worker for the
// chat the conversation is in. On the dashboard the row is the delivery: the
// transcript shows it as a download.

/** What the worker relays for a file it downloaded. */
export interface InboundFile {
  mimeType: string;
  // Raw base64, no data: prefix.
  base64: string;
  fileName?: string;
}

// How much of a document's text rides inline on the operator's message. The
// model reads the rest with read_attachment, a page at a time — the history
// budget is 120k characters for the whole conversation, and one spreadsheet
// must not be able to push everything else out of it.
export const INLINE_CHARS = 8_000;
export const PAGE_CHARS = 10_000;

// Over WhatsApp the worker refuses anything bigger before downloading it; this
// is the same limit, enforced again here for the dashboard's uploads.
export const MAX_INBOUND_BYTES = env.AGENT_MAX_FILE_MB * 1024 * 1024;
// WhatsApp's own ceiling for a document is far higher; this keeps one send
// from holding a 2 GB buffer in a process that also serves the shop.
export const MAX_OUTBOUND_BYTES = 30 * 1024 * 1024;

// ------------------------------------------------------------------- inbound

/**
 * Store and read one inbound file, returning what goes on the message.
 * Never throws for a bad file: an unreadable one is still recorded, and the
 * attachment says why, so the model asks for it again instead of guessing.
 */
export async function ingestFile(fastify: FastifyInstance, threadId: string, file: InboundFile): Promise<Attachment> {
  const bytes = Buffer.from(file.base64, 'base64');
  if (!bytes.length) return { kind: 'file', unreadable: 'the file arrived empty — ask for it again' };
  if (bytes.length > MAX_INBOUND_BYTES) {
    return { kind: 'file', name: file.fileName, unreadable: `the file is over ${env.AGENT_MAX_FILE_MB} MB and was not read — ask for a smaller one or the part that matters` };
  }
  const digest = sha256(bytes);

  // The same file again in the same conversation — most often because the
  // operator REPLIED to it, which re-sends the whole file as the quoted
  // message. Reuse the first reading: same text, no second OCR bill.
  const seen = await fastify.prisma.agentMedia.findFirst({
    where: { threadId, sha256: digest, direction: 'in', purgedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (seen) return attachmentFor(seen);

  const type = await sniffType(bytes, file.mimeType, file.fileName);
  const fileName = cleanFileName(file.fileName ?? (type.family === 'image' ? 'photo' : 'file'), type.ext);
  const storedName = await writeAgentMedia(bytes, type.ext);
  const row = await fastify.prisma.agentMedia.create({
    data: {
      threadId,
      direction: 'in',
      kind: type.family === 'image' ? 'image' : 'document',
      fileName,
      mimeType: type.mime,
      sizeBytes: bytes.length,
      sha256: digest,
      storedName,
    },
  });

  try {
    const read = await extractFile(bytes, type, fileName);
    return attachmentFor(
      await fastify.prisma.agentMedia.update({
        where: { id: row.id },
        data: { text: read.text, textMethod: read.method, pages: read.pages ?? null, costUsd: read.costUsd },
      })
    );
  } catch (err: any) {
    const reason = err instanceof UnreadableFile ? err.message : `it could not be read (${err?.message ?? 'unknown error'})`;
    if (!(err instanceof UnreadableFile)) fastify.log.error({ err, mediaId: row.id }, 'could not extract an inbound file');
    return attachmentFor(await fastify.prisma.agentMedia.update({ where: { id: row.id }, data: { error: reason.slice(0, 500) } }));
  }
}

/** The message-side view of a stored file: its identity, and the opening of its text. */
export function attachmentFor(m: AgentMedia): Attachment {
  const kind = m.kind === 'image' ? 'image' : 'file';
  const base = { kind, mediaId: m.id, name: m.fileName, mimeType: m.mimeType, sizeBytes: m.sizeBytes, ...(m.pages ? { pages: m.pages } : {}) } as const;
  if (m.error || m.text == null) return { ...base, unreadable: m.error ?? 'it could not be read' };
  // A picture's transcript is short and is the whole point; a document's text
  // is shown up to INLINE_CHARS and the rest is a read_attachment away.
  if (kind === 'image' || m.text.length <= INLINE_CHARS) return { ...base, text: m.text, method: m.textMethod ?? undefined };
  return { ...base, text: cutAtLine(m.text, INLINE_CHARS), method: m.textMethod ?? undefined, totalChars: m.text.length, truncated: true };
}

function cutAtLine(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf('\n', max);
  return text.slice(0, cut > max * 0.6 ? cut : max);
}

/**
 * A window of a stored file's text. `page` uses the markers the extractor
 * writes ("--- Page 3 ---", "--- Sheet …", "--- Slide 2 ---"); `from` is a
 * character offset for anything without them.
 */
export function readWindow(text: string, opts: { page?: number; from?: number }): { text: string; from: number; to: number; total: number; nextFrom: number | null; page?: number } {
  const total = text.length;
  let from = Math.max(0, Math.min(opts.from ?? 0, total));
  let page: number | undefined;
  if (opts.page) {
    const markers = [...text.matchAll(/^--- (Page|Sheet|Slide) .*---$/gm)];
    const m = markers[opts.page - 1];
    if (!m) throw new Error(`There is no part ${opts.page} — this file has ${markers.length || 1}.`);
    from = m.index!;
    page = opts.page;
  }
  let to = Math.min(total, from + PAGE_CHARS);
  if (to < total) {
    const cut = text.lastIndexOf('\n', to);
    if (cut > from + PAGE_CHARS * 0.6) to = cut;
  }
  return { text: text.slice(from, to), from, to, total, nextFrom: to < total ? to : null, ...(page ? { page } : {}) };
}

/**
 * Every line of a stored file that mentions the query, with the line either
 * side and the page/sheet/slide it is on. Finding one transfer in a 30-page
 * statement by paging through it 10,000 characters at a time is how a model
 * gives up on page 9 and reports there is nothing there; a search is one call.
 * All words of the query must appear on the line, in any case and order.
 */
export function searchText(text: string, query: string, max = 25): { matches: { part: string | null; line: string; context: string }[]; total: number } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return { matches: [], total: 0 };
  const lines = text.split('\n');
  let part: string | null = null;
  const matches: { part: string | null; line: string; context: string }[] = [];
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const marker = /^--- ((?:Page|Sheet|Slide) .*?) ---$/.exec(lines[i]);
    if (marker) {
      part = marker[1];
      continue;
    }
    const lower = lines[i].toLowerCase();
    if (!words.every((w) => lower.includes(w))) continue;
    total++;
    if (matches.length < max) {
      matches.push({ part, line: lines[i].trim(), context: lines.slice(Math.max(0, i - 1), i + 2).join('\n').trim() });
    }
  }
  return { matches, total };
}

// ------------------------------------------------------------------ outbound

export interface OutboundFile {
  bytes: Buffer;
  fileName: string;
  mimeType: string;
  // For the audit row: what produced it.
  source: string;
}

/** A filed document from the document store. */
export async function documentFile(fastify: FastifyInstance, documentId: string): Promise<OutboundFile> {
  const doc = await fastify.prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error(`No document with id ${documentId}.`);
  const bytes = await readFile(documentPath(doc.filename)).catch(() => {
    throw new Error(`The file for "${doc.title}" is missing from the document store.`);
  });
  return { bytes, fileName: cleanFileName(doc.originalName, extOfMime(doc.mimeType)), mimeType: doc.mimeType, source: `document:${doc.id}` };
}

/** An order's receipt, generated now — the same PDF the dashboard prints. */
export async function receiptFile(fastify: FastifyInstance, orderRef: string): Promise<OutboundFile> {
  const raw = orderRef.trim();
  const order = await fastify.prisma.order.findFirst({
    where: { OR: [{ id: raw }, { orderNumber: { equals: raw, mode: 'insensitive' } }], deletedAt: null },
    select: { id: true, orderNumber: true },
  });
  if (!order) throw new Error(`No order matching "${orderRef}".`);
  const bytes = await adminGetReceiptPdf(fastify, order.id);
  return { bytes, fileName: `Receipt ${order.orderNumber.replace(/\//g, '-')}.pdf`, mimeType: 'application/pdf', source: `receipt:${order.orderNumber}` };
}

/**
 * A product photo from the catalogue. With a size, that variant's own photo
 * when it has one; otherwise the product's first gallery image.
 */
export async function productImageFile(fastify: FastifyInstance, productRef: string, size?: string): Promise<OutboundFile> {
  const raw = productRef.trim();
  const product = await fastify.prisma.product.findFirst({
    where: { OR: [{ id: raw }, { slug: raw.toLowerCase() }, { name: { equals: raw, mode: 'insensitive' } }, { name: { contains: raw, mode: 'insensitive' } }] },
    include: { images: { orderBy: { sortOrder: 'asc' } }, variants: { select: { id: true, size: true, imageUrl: true } } },
  });
  if (!product) throw new Error(`No product matching "${productRef}".`);
  const variant = size ? product.variants.find((v) => (v.size ?? '').toLowerCase().replace(/\s/g, '') === size.toLowerCase().replace(/\s/g, '')) : undefined;
  if (size && !variant) throw new Error(`${product.name} has no ${size} size — it comes in ${product.variants.map((v) => v.size).filter(Boolean).join(', ') || 'one size'}.`);
  // The variant's own photo, else the product gallery's first, else any
  // variant photo — the same order the storefront falls back in.
  const url = variant?.imageUrl ?? product.images[0]?.url ?? product.variants.find((v) => v.imageUrl)?.imageUrl;
  if (!url) throw new Error(`${product.name} has no photo in the catalogue yet.`);
  const bytes = await readUpload(url);
  const { mime, ext } = await sniffType(bytes);
  if (!mime.startsWith('image/')) throw new Error(`The catalogue file for ${product.name} is not a picture.`);
  const label = `${product.name}${variant?.size ? ` ${variant.size}` : ''}`;
  return { bytes, fileName: `${label}.${ext}`, mimeType: mime, source: `product-image:${product.id}${variant ? `:${variant.id}` : ''}` };
}

// Catalogue images are served from /uploads, which is this process's own
// disk. Read from there rather than over HTTP: no self-request, no CDN, and a
// path outside uploads/ can never be reached.
async function readUpload(url: string): Promise<Buffer> {
  const rel = url.replace(/^https?:\/\/[^/]+/, '').replace(/^\/uploads\//, '');
  const root = path.join(process.cwd(), 'uploads');
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep)) throw new Error('That image is not in the catalogue store.');
  return readFile(full).catch(() => {
    throw new Error('The photo is listed in the catalogue but its file is missing.');
  });
}

/** A file from earlier in this conversation — sent by an operator, or by the assistant. */
export async function earlierFile(fastify: FastifyInstance, threadId: string, mediaId: string): Promise<OutboundFile> {
  const m = await fastify.prisma.agentMedia.findFirst({ where: { id: mediaId, threadId } });
  if (!m) throw new Error(`No file ${mediaId} in this conversation.`);
  if (!m.storedName) throw new Error(`"${m.fileName}" is no longer kept — files are cleared after ${env.AGENT_MEDIA_RETENTION_DAYS} days unless filed in the document store.`);
  return { bytes: await readAgentMedia(m.storedName), fileName: m.fileName, mimeType: m.mimeType, source: `forward:${m.id}` };
}

/**
 * A spreadsheet straight from the database. The rows never pass through the
 * model — it writes the query, the database fills the file — so an export of
 * 3,000 orders is exactly the 3,000 orders, not a transcription of them.
 */
export async function reportFile(fastify: FastifyInstance, sql: string, title: string): Promise<OutboundFile & { rows: number; columns: string[]; timezoneWarning?: string }> {
  const raw = await runReadOnlyQuery(fastify.prisma, sql, 10_000);
  if (!raw.length) throw new Error('The query returned no rows — there is nothing to put in a spreadsheet.');
  // Timestamps arrive as UTC ISO strings; the people opening this sheet live in
  // Malaysia time, so that is what the cells say.
  const rows = raw.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) ? toMalaysiaIso(v).slice(0, 16).replace('T', ' ') : v]))
  );
  const columns = Object.keys(rows[0]);
  const sheet = XLSX.utils.json_to_sheet(rows, { header: columns });
  sheet['!cols'] = columns.map((c) => ({ wch: Math.min(40, Math.max(c.length, ...rows.slice(0, 200).map((r) => String(r[c] ?? '').length)) + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, safeSheetName(title));
  const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
  return {
    bytes,
    fileName: cleanFileName(`${title}.xlsx`, 'xlsx'),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    source: 'report',
    rows: rows.length,
    columns,
    ...(timezoneWarning(sql) ? { timezoneWarning: timezoneWarning(sql) } : {}),
  };
}

function safeSheetName(title: string): string {
  return title.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Report';
}

function extOfMime(mime: string): string {
  const map: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'image/gif': 'gif',
  };
  return map[mime] ?? 'bin';
}

export interface Delivery {
  mediaId: string;
  fileName: string;
  sizeKb: number;
  sentAs: 'image' | 'document';
  // Where it went, in words the model can repeat.
  deliveredTo: string;
}

/**
 * Record an outbound file and put it in front of the person: over WhatsApp,
 * into `chatKey`'s chat; on the dashboard, the stored row IS the delivery.
 *
 * A picture travels as a photo (converted to JPEG — WhatsApp shows a WebP as
 * a sticker), everything else as a document with its filename.
 */
export async function deliverFile(
  fastify: FastifyInstance,
  opts: { threadId: string; chatKey: string; label: string; caption?: string },
  file: OutboundFile,
): Promise<Delivery> {
  if (file.bytes.length > MAX_OUTBOUND_BYTES) throw new Error(`"${file.fileName}" is ${Math.round(file.bytes.length / 1024 / 1024)} MB — over the 30 MB a send is allowed.`);

  let bytes = file.bytes;
  let mimeType = file.mimeType;
  let fileName = file.fileName;
  const asImage = mimeType.startsWith('image/');
  if (asImage && mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
    bytes = await sharp(bytes, { failOn: 'none' }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
    mimeType = 'image/jpeg';
    fileName = fileName.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
  }

  const type = await sniffType(bytes, mimeType, fileName);
  const storedName = await writeAgentMedia(bytes, type.ext);
  const row = await fastify.prisma.agentMedia.create({
    data: {
      threadId: opts.threadId,
      direction: 'out',
      kind: asImage ? 'image' : 'document',
      fileName,
      mimeType,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      storedName,
      source: file.source,
    },
  });

  if (!opts.chatKey.startsWith('web:')) {
    try {
      await sendWhatsAppFile(targetFromChatKey(opts.chatKey), {
        kind: asImage ? 'image' : 'document',
        base64: bytes.toString('base64'),
        mimeType,
        fileName,
        caption: opts.caption,
      });
    } catch (err: any) {
      await fastify.prisma.agentMedia.update({ where: { id: row.id }, data: { error: `not delivered: ${String(err?.message ?? err).slice(0, 300)}` } });
      throw new Error(`WhatsApp did not take the file: ${err?.message ?? err}`);
    }
  }

  return { mediaId: row.id, fileName, sizeKb: Math.max(1, Math.round(bytes.length / 1024)), sentAs: asImage ? 'image' : 'document', deliveredTo: opts.label };
}

// ------------------------------------------------------------------- purging

/**
 * Inbound files older than the retention window lose their bytes; the row,
 * its extracted text and its place in the transcript stay. Outbound files go
 * the same way — every one of them can be produced again from its source.
 */
export async function purgeOldMedia(fastify: FastifyInstance): Promise<number> {
  const cutoff = new Date(Date.now() - env.AGENT_MEDIA_RETENTION_DAYS * 86_400_000);
  const old = await fastify.prisma.agentMedia.findMany({
    where: { createdAt: { lt: cutoff }, storedName: { not: null } },
    select: { id: true, storedName: true },
    take: 500,
  });
  for (const m of old) {
    await deleteAgentMedia(m.storedName!);
    await fastify.prisma.agentMedia.update({ where: { id: m.id }, data: { storedName: null, purgedAt: new Date() } });
  }
  if (old.length) fastify.log.info(`agent media: purged ${old.length} file(s) older than ${env.AGENT_MEDIA_RETENTION_DAYS} days`);
  return old.length;
}
