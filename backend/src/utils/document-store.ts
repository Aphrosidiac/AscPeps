import { open, mkdir, unlink } from 'fs/promises';
import path from 'path';

/**
 * Where uploaded documents live, and what is allowed to be one.
 *
 * Deliberately NOT `uploads/`. That directory is registered with
 * @fastify/static in server.ts and served to the whole internet — the comment
 * there says so outright, and it loosens Cross-Origin-Resource-Policy so mail
 * clients can fetch product thumbnails. All correct for a product photo.
 *
 * A receipt is a different thing entirely: it carries a customer's name, phone
 * and address, or our own bank details. A UUID filename is obscurity, not
 * access control — once that URL reaches a browser history, a forwarded
 * message or a proxy log, it is readable by anyone forever. So documents sit in
 * their own directory that nothing serves statically, and the only way to read
 * one is the authenticated route in admin-documents.controller.ts.
 *
 * Keeping them in a separate tree also means a future change that widens the
 * static mount cannot expose them by accident.
 */
export const DOCUMENTS_DIR = path.join(process.cwd(), 'documents');

export async function ensureDocumentsDir(): Promise<void> {
  await mkdir(DOCUMENTS_DIR, { recursive: true });
}

/**
 * `filename` always comes from our own database, where it was written as
 * `<uuid>.<ext>`. Resolved and re-checked anyway: a path that escapes the
 * directory must never be readable, whatever a bug upstream might allow into
 * that column.
 */
export function documentPath(filename: string): string {
  const resolved = path.resolve(DOCUMENTS_DIR, filename);
  if (resolved !== path.join(DOCUMENTS_DIR, path.basename(filename))) {
    throw { statusCode: 400, message: 'Invalid document path' };
  }
  return resolved;
}

export async function deleteDocumentFile(filename: string): Promise<void> {
  await unlink(documentPath(filename)).catch(() => {});
}

/**
 * What may be stored, by real content rather than by the client's claim.
 *
 * PDFs and images only, and every one of them is verified from its magic bytes.
 * That is not a hedge about effort — it is what lets the read route serve a
 * document inline without worrying that its bytes are secretly HTML or SVG that
 * would execute against the admin's own session. A plain-text format like CSV
 * cannot be sniffed at all, so allowing one would mean allowing arbitrary text
 * and giving up that guarantee; if bank-statement CSVs are wanted later they
 * should be stored as attachment-only and never served inline.
 */
export const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
] as const;

export type AllowedMime = (typeof ALLOWED_MIME)[number];

const EXTENSION: Record<AllowedMime, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
};

export function extensionFor(mime: AllowedMime): string {
  return EXTENSION[mime];
}

/** Human list for error messages, so a rejection says what WOULD work. */
export const ALLOWED_LABEL = 'PDF, JPEG, PNG, WebP, AVIF or HEIC';

/**
 * Identify a file from its first bytes. The browser-declared Content-Type is
 * attacker-controlled and is never trusted — same rule the product image
 * endpoint already follows.
 */
export async function sniffDocumentType(filepath: string): Promise<AllowedMime | null> {
  const fh = await open(filepath, 'r');
  try {
    const { buffer: b, bytesRead } = await fh.read(Buffer.alloc(16), 0, 16, 0);
    if (bytesRead < 12) return null;

    if (b.toString('ascii', 0, 4) === '%PDF') return 'application/pdf';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';

    // ISO base media container: AVIF and HEIC share the `ftyp` header and are
    // told apart by the brand that follows it.
    if (b.toString('ascii', 4, 8) === 'ftyp') {
      const brand = b.toString('ascii', 8, 12);
      if (brand === 'avif' || brand === 'avis') return 'image/avif';
      if (brand === 'heic' || brand === 'heix' || brand === 'heim' || brand === 'mif1' || brand === 'msf1') {
        return 'image/heic';
      }
    }
    return null;
  } finally {
    await fh.close();
  }
}

/**
 * Whether a browser can be trusted to display this inline rather than being
 * handed it as a download. Both are served from the same authenticated route;
 * this only decides Content-Disposition.
 */
export function isInlineViewable(mime: string): boolean {
  return mime === 'application/pdf' || mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp';
}
