import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
const MAX_SIZE = 5 * 1024 * 1024;

export default async function adminUploadRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.authenticate);

  fastify.post('/image', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    if (!ALLOWED_TYPES.includes(data.mimetype)) {
      return reply.status(400).send({ error: 'Invalid file type. Use JPEG, PNG, or WebP.' });
    }

    const ext = data.mimetype.split('/')[1].replace('jpeg', 'jpg');
    const filename = `${randomUUID()}.${ext}`;
    const uploadsDir = path.join(process.cwd(), 'uploads', 'products');

    await mkdir(uploadsDir, { recursive: true });

    const filepath = path.join(uploadsDir, filename);
    await pipeline(data.file, createWriteStream(filepath));

    if (data.file.truncated) {
      return reply.status(400).send({ error: `File too large. Max ${MAX_SIZE / 1024 / 1024}MB.` });
    }

    const url = `/uploads/products/${filename}`;
    return { url, filename };
  });
}
