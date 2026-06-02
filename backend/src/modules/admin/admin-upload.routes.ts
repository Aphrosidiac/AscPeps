import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir, unlink, open, rename } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const EXT_FOR: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

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

    // Write to a temp name first; the final extension comes from the SNIFFED
    // type, not the client header.
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

    const filename = `${id}.${EXT_FOR[detected]}`;
    await rename(tmppath, path.join(uploadsDir, filename));

    const url = `/uploads/products/${filename}`;
    return { url, filename };
  });
}
