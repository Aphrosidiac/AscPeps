#!/usr/bin/env node
/**
 * Backfill the email-safe JPEG thumbnails for every already-uploaded product
 * image.
 *
 * Why this exists: uploads are stored as WebP, and WebP is missing from older
 * Outlook desktop builds — a WebP <img> in an email renders as a broken-image
 * icon there. admin-upload.routes.ts now writes an `<id>.email.jpg` sibling on
 * every new upload; this script does the same for the images that already
 * existed. Without it, product thumbnails in the mail templates fall back to
 * the placeholder tile for the entire existing catalogue.
 *
 * Idempotent: skips any thumb that already exists unless --force is passed.
 * Safe to re-run. Run on the box that owns the uploads directory:
 *
 *   node scripts/generate-email-thumbs.mjs [--dry-run] [--force]
 */
import { readdir, stat, access } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const DRY = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

// Mirrors admin-upload.routes.ts — keep the three constants in sync.
const EMAIL_THUMB_WIDTH = 160;
const EMAIL_THUMB_QUALITY = 80;
const thumbName = (f) => f.replace(/\.[^.]+$/, '') + '.email.jpg';

const uploadsDir = path.resolve(process.cwd(), 'uploads/products');

const exists = (p) => access(p).then(() => true, () => false);

async function main() {
  if (!(await exists(uploadsDir))) {
    console.error(`uploads dir not found: ${uploadsDir}`);
    console.error('Run this from the backend/ directory on the machine holding the uploads.');
    process.exit(1);
  }

  const files = (await readdir(uploadsDir))
    // Only real source images. `.email.jpg` files are our own output — picking
    // them up again would generate `<id>.email.email.jpg` on every run.
    .filter((f) => /\.(webp|jpe?g|png|avif)$/i.test(f) && !f.endsWith('.email.jpg'));

  let made = 0, skipped = 0, failed = 0, bytes = 0;

  for (const f of files) {
    const src = path.join(uploadsDir, f);
    const dest = path.join(uploadsDir, thumbName(f));

    if (!FORCE && (await exists(dest))) { skipped++; continue; }
    if (DRY) { console.log(`would write ${thumbName(f)}`); made++; continue; }

    try {
      await sharp(src)
        .rotate()
        .resize({ width: EMAIL_THUMB_WIDTH, withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: EMAIL_THUMB_QUALITY, mozjpeg: true })
        .toFile(dest);
      bytes += (await stat(dest)).size;
      made++;
    } catch (err) {
      console.error(`FAILED ${f}: ${err.message}`);
      failed++;
    }
  }

  console.log(
    `\n${DRY ? '[dry run] ' : ''}${files.length} source images — ` +
      `${made} thumb(s) ${DRY ? 'to write' : 'written'}, ${skipped} already present, ${failed} failed` +
      (bytes ? ` (${(bytes / 1024).toFixed(0)}KB total, ${(bytes / made / 1024).toFixed(1)}KB avg)` : '')
  );
  if (failed) process.exitCode = 1;
}

main();
