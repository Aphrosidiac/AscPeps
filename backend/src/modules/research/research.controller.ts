import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import type { LiveArticle } from './research.rules.js';

// Public reads for /research: the published copy only. Drafts never leave the admin API.

export async function listResearch(fastify: FastifyInstance) {
  const rows = await fastify.prisma.researchArticle.findMany({ where: { live: { not: Prisma.DbNull } }, select: { id: true, live: true } });
  const data = rows
    .map(({ id, live }) => {
      const a = live as unknown as LiveArticle;
      return { id, slug: a.slug, title: a.title, dek: a.dek, datePublished: a.datePublished, dateModified: a.dateModified, updatedAt: a.updatedAt };
    })
    // Newest first; same-day articles alphabetically, so the order is stable.
    .sort((x, y) => y.datePublished.localeCompare(x.datePublished) || x.title.localeCompare(y.title));
  return { data };
}

/** The live article, or 404 carrying where the URL went: `{ redirect }` (301) or `{ gone: true }`. */
export async function getResearchBySlug(fastify: FastifyInstance, slug: string) {
  const row = await fastify.prisma.researchArticle.findFirst({ where: { slug, live: { not: Prisma.DbNull } }, select: { id: true, live: true } });
  if (row) return { id: row.id, ...(row.live as unknown as LiveArticle) };
  const moved = await fastify.prisma.researchRedirect.findUnique({ where: { fromSlug: slug } });
  if (moved) throw { statusCode: 404, message: moved.toPath ? 'Moved' : 'Gone', details: [{ path: moved.toPath ? 'redirect' : 'gone', message: moved.toPath ?? 'gone' }] };
  throw { statusCode: 404, message: 'Research article not found' };
}
