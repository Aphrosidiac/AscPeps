import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { fileTypeFromBuffer } from 'file-type';

/**
 * Where files that pass through the assistant live, and what they really are.
 *
 * Same rule as documents/ (see document-store.ts), for the same reason: these
 * are invoices, bank slips and screenshots of customers' orders. agent-media/
 * is never registered with @fastify/static; the only readers are the
 * authenticated dashboard route and the code that hands bytes to the WhatsApp
 * worker. A separate tree from documents/ so a purge of old chat files can
 * never reach a filed document.
 */
export const AGENT_MEDIA_DIR = path.join(process.cwd(), 'agent-media');

export function agentMediaPath(storedName: string): string {
  const resolved = path.resolve(AGENT_MEDIA_DIR, storedName);
  if (resolved !== path.join(AGENT_MEDIA_DIR, path.basename(storedName))) {
    throw new Error('Invalid media path');
  }
  return resolved;
}

export async function writeAgentMedia(bytes: Buffer, ext: string): Promise<string> {
  await mkdir(AGENT_MEDIA_DIR, { recursive: true });
  const storedName = `${randomUUID()}.${ext.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'}`;
  await writeFile(agentMediaPath(storedName), bytes, { mode: 0o600 });
  return storedName;
}

export function readAgentMedia(storedName: string): Promise<Buffer> {
  return readFile(agentMediaPath(storedName));
}

export async function deleteAgentMedia(storedName: string): Promise<void> {
  await unlink(agentMediaPath(storedName)).catch(() => {});
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// ------------------------------------------------------------------ typing

export type FileFamily = 'image' | 'pdf' | 'docx' | 'sheet' | 'pptx' | 'text' | 'other';

export interface SniffedType {
  mime: string;
  ext: string;
  family: FileFamily;
}

const SHEET_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/x-cfb', // legacy .xls is an OLE container; file-type reports the container
  'application/vnd.oasis.opendocument.spreadsheet',
]);

// Plain-text formats have no magic number, so for these alone the sender's
// declared type (or the filename) is believed — after the bytes are checked
// to really be text.
const TEXT_EXT: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  log: 'text/plain',
};

function extOf(fileName: string | undefined): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(fileName ?? '');
  return m ? m[1].toLowerCase() : '';
}

/** Looks like text: valid UTF-8 with no NUL bytes in the first 64 KB. */
function isText(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 65_536);
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.subarray(0, Math.max(0, head.length - 4)));
    return true;
  } catch {
    return false;
  }
}

/**
 * What a file actually is, from its bytes. The WhatsApp mimetype and the
 * filename are claims made by whoever sent it; they decide nothing except for
 * plain text, which cannot be identified any other way.
 */
export async function sniffType(bytes: Buffer, declaredMime?: string, fileName?: string): Promise<SniffedType> {
  const ft = await fileTypeFromBuffer(bytes).catch(() => undefined);
  const nameExt = extOf(fileName);

  if (ft) {
    if (ft.mime.startsWith('image/')) return { mime: ft.mime, ext: ft.ext, family: 'image' };
    if (ft.mime === 'application/pdf') return { mime: ft.mime, ext: 'pdf', family: 'pdf' };
    if (ft.ext === 'docx') return { mime: ft.mime, ext: 'docx', family: 'docx' };
    if (ft.ext === 'pptx') return { mime: ft.mime, ext: 'pptx', family: 'pptx' };
    if (ft.ext === 'xlsx' || ft.ext === 'ods' || SHEET_MIME.has(ft.mime)) {
      // An OLE container is .xls only when the sender said so; .doc and .ppt
      // share the format and are not something this reads.
      if (ft.mime === 'application/x-cfb' && nameExt !== 'xls' && declaredMime !== 'application/vnd.ms-excel') {
        return { mime: ft.mime, ext: nameExt || 'bin', family: 'other' };
      }
      return { mime: ft.mime === 'application/x-cfb' ? 'application/vnd.ms-excel' : ft.mime, ext: ft.ext === 'cfb' ? 'xls' : ft.ext, family: 'sheet' };
    }
    return { mime: ft.mime, ext: ft.ext, family: 'other' };
  }

  if (isText(bytes)) {
    const ext = TEXT_EXT[nameExt] ? nameExt : 'txt';
    return { mime: TEXT_EXT[ext], ext, family: ext === 'csv' || ext === 'tsv' ? 'sheet' : 'text' };
  }
  return { mime: declaredMime || 'application/octet-stream', ext: nameExt || 'bin', family: 'other' };
}

/** A filename safe to show and to hand to WhatsApp: no path, no control characters. */
export function cleanFileName(name: string | undefined | null, fallbackExt: string): string {
  const base = path.basename(String(name ?? '')).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (base) return extOf(base) ? base : `${base}.${fallbackExt}`;
  return `file.${fallbackExt}`;
}
