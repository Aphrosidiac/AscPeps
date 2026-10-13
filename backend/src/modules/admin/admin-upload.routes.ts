import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, unlink, open } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import sharp from 'sharp';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const WEBP_QUALITY = 82;

// Widest we'll store. Re-encoding to WebP alone doesn't bound dimensions, so a
// phone photo or a screenshot of a journal figure was previously kept at full
// size — an article with several such images is a very heavy page. 1600px is
// comfortably above the widest slot anything is rendered in (the article column
// is max-w-3xl) while leaving enough detail to zoom into a diagram's labels.
// `withoutEnlargement` so a small image is never upscaled into blur.
const MAX_IMAGE_WIDTH = 1600;

// Email clients are a different world from browsers: WebP is missing from older
// Outlook desktop builds and AVIF is effectively unsupported everywhere, so a
// product thumbnail in an email has to be JPEG/PNG/GIF or it renders as a
// broken-image icon. Every stored image therefore gets a small JPEG sibling
// written beside it (`<id>.email.jpg`), used only by the mail templates.
// 160px covers the 56px slot at 2x with headroom, at ~4-6KB.
const EMAIL_THUMB_WIDTH = 160;
const EMAIL_THUMB_QUALITY = 80;

/** `<id>.webp` -> `<id>.email.jpg`. Mirrored by emailThumbUrl() in emails/layout.ts. */
export function emailThumbFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') + '.email.jpg';
}

// The campaign product cards need a picture an order of magnitude larger than
// the 56px order-line thumb: 528px wide at most, so 640 covers it at ~1.2x
// and the half-width grid tiles at 2.4x. Cropped to 5:4 rather than kept
// square — a square photo that wide is a full phone screen of vial before the
// reader reaches a price. Not sharp's "attention" crop, which took the vial's
// cap off. Measured on the studio shots at 640px: the cap starts at y=123 and
// the corner pill mark ends at y=599, so a 512px window has to start between
// 88 and 123. Taking 82% of the spare height from the top starts it at 105,
// leaving the same margin above the cap as below the mark.
const EMAIL_CARD_WIDTH = 640;
const EMAIL_CARD_HEIGHT = 512;
const EMAIL_CARD_QUALITY = 82;
const EMAIL_CARD_BIAS = 0.82;

/** `<id>.webp` -> `<id>.card.jpg`. Mirrored by emailCardUrl() in emails/layout.ts. */
export function emailCardFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') + '.card.jpg';
}

/** Writes the campaign-card JPEG sibling. Never throws, same as the thumb:
 *  a missing card falls back to the typographic tile. */
export async function writeEmailCard(sourcePath: string, destPath: string): Promise<boolean> {
  try {
    const { data, info } = await sharp(sourcePath)
      .rotate()
      .resize({ width: EMAIL_CARD_WIDTH })
      .flatten({ background: '#ffffff' })
      .toBuffer({ resolveWithObject: true });
    const out =
      info.height >= EMAIL_CARD_HEIGHT
        ? sharp(data).extract({
            left: 0,
            top: Math.round((info.height - EMAIL_CARD_HEIGHT) * EMAIL_CARD_BIAS),
            width: info.width,
            height: EMAIL_CARD_HEIGHT,
          })
        : sharp(data).resize({ width: EMAIL_CARD_WIDTH, height: EMAIL_CARD_HEIGHT, fit: 'cover' });
    await out.jpeg({ quality: EMAIL_CARD_QUALITY, mozjpeg: true }).toFile(destPath);
    return true;
  } catch {
    return false;
  }
}

/** Writes the email-safe JPEG sibling. Never throws — a missing thumb degrades
 *  to the placeholder tile in the mail template, which is not worth failing an
 *  upload over. */
export async function writeEmailThumb(sourcePath: string, destPath: string): Promise<boolean> {
  try {
    await sharp(sourcePath)
      .rotate()
      .resize({ width: EMAIL_THUMB_WIDTH, withoutEnlargement: true })
      .flatten({ background: '#ffffff' }) // JPEG has no alpha; a transparent PNG would otherwise go black
      .jpeg({ quality: EMAIL_THUMB_QUALITY, mozjpeg: true })
      .toFile(destPath);
    return true;
  } catch {
    return false;
  }
}

// Detect the real image type from the file's magic bytes — the client-declared
// Content-Type is spoofable and must not be trusted.
async function sniffImageType(filepath: string): Promise<string | null> {
  const fh = await open(filepath, 'r');
  try {
    const { buffer: b } = await fh.read(Buffer.alloc(16), 0, 16, 0);
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (b.toString('ascii', 4, 8) === 'ftyp') {
      const brand = b.toString('ascii', 8, 12);
      if (brand === 'avif' || brand === 'avis') return 'image/avif';
    }
    return null;
  } finally {
    await fh.close();
  }
}

export default async function adminUploadRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/image', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    if (!ALLOWED_TYPES.includes(data.mimetype)) {
      await data.file.resume();
      return reply.status(400).send({ error: 'Invalid file type. Use JPEG, PNG, or WebP.' });
    }

    const id = randomUUID();
    const uploadsDir = path.join(process.cwd(), 'uploads', 'products');
    await mkdir(uploadsDir, { recursive: true });

    const tmppath = path.join(uploadsDir, `${id}.tmp`);

    try {
      await pipeline(data.file, createWriteStream(tmppath));
    } catch {
      await unlink(tmppath).catch(() => {});
      return reply.status(400).send({ error: 'File upload failed. File may be too large (max 5MB).' });
    }

    if (data.file.truncated) {
      await unlink(tmppath).catch(() => {});
      return reply.status(400).send({ error: 'File too large. Max 5MB.' });
    }

    // Validate the actual bytes are a real, allowed image.
    const detected = await sniffImageType(tmppath);
    if (!detected || !ALLOWED_TYPES.includes(detected)) {
      await unlink(tmppath).catch(() => {});
      return reply.status(400).send({ error: 'File content is not a valid image (JPEG, PNG, WebP, or AVIF).' });
    }

    // Re-encode to WebP regardless of source format — smaller files on disk
    // and one consistent format for every stored product image.
    const filename = `${id}.webp`;
    try {
      await sharp(tmppath)
        .rotate() // honour EXIF orientation before resizing, or a phone photo lands sideways
        .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toFile(path.join(uploadsDir, filename));
    } catch {
      return reply.status(400).send({ error: 'Failed to process image.' });
    }

    // From the stored WebP, not the temp original — so the thumb always matches
    // exactly what the site serves, including the EXIF rotation applied above.
    await writeEmailThumb(
      path.join(uploadsDir, filename),
      path.join(uploadsDir, emailThumbFilename(filename))
    );
    await writeEmailCard(
      path.join(uploadsDir, filename),
      path.join(uploadsDir, emailCardFilename(filename))
    );
    await unlink(tmppath).catch(() => {});

    const url = `/uploads/products/${filename}`;
    return { url, filename };
  });
}
