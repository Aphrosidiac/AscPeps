import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { notifyRevalidate } from '../../utils/revalidate.js';

// `.optional()`, never `.default()`, on every field here — an update payload
// is partial (e.g. just `{ published: true }`), and a schema-level default
// would silently overwrite every field the admin didn't touch. Same
// discipline as productObjectSchema in admin-products.controller.ts.
const insightObjectSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  category: z.string().min(1),
  excerpt: z.string().min(1),
  content: z.string().min(1),
  coverImageUrl: z.string().nullable().optional(),
  authorName: z.string().min(1).optional(),
  authorRole: z.string().min(1).optional(),
  citationTitle: z.string().nullable().optional(),
  citationSource: z.string().nullable().optional(),
  citationUrl: z.string().nullable().optional(),
  relatedProductIds: z.array(z.string()).optional(),
  published: z.boolean().optional(),
});

const createInsightSchema = insightObjectSchema;
const updateInsightSchema = insightObjectSchema.partial();

// ~200 words/minute, rounded up so even a short update never reads as 0 min.
function estimateReadTime(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

export async function adminListInsights(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);

  const where: Record<string, unknown> = {};
  if (query.category) where.category = query.category;
  if (query.search) where.title = { contains: query.search, mode: 'insensitive' };
  if (query.status === 'published') where.published = true;
  if (query.status === 'draft') where.published = false;

  const [insights, total] = await Promise.all([
    fastify.prisma.insight.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    fastify.prisma.insight.count({ where }),
  ]);

  return paginatedResponse(insights, total, page, limit);
}

export async function adminGetInsight(fastify: FastifyInstance, id: string) {
  const insight = await fastify.prisma.insight.findUnique({ where: { id } });
  if (!insight) throw { statusCode: 404, message: 'Insight not found' };
  return insight;
}

export async function adminCreateInsight(fastify: FastifyInstance, body: unknown) {
  const data = createInsightSchema.parse(body);

  const insight = await fastify.prisma.insight.create({
    data: {
      ...data,
      readTimeMinutes: estimateReadTime(data.content),
      publishedAt: data.published ? new Date() : null,
    },
  });

  notifyRevalidate(['insights']);
  return insight;
}

export async function adminUpdateInsight(fastify: FastifyInstance, id: string, body: unknown) {
  const data = updateInsightSchema.parse(body);

  const existing = await fastify.prisma.insight.findUnique({ where: { id } });
  if (!existing) throw { statusCode: 404, message: 'Insight not found' };

  const insight = await fastify.prisma.insight.update({
    where: { id },
    data: {
      ...data,
      ...(data.content !== undefined ? { readTimeMinutes: estimateReadTime(data.content) } : {}),
      ...(data.published && !existing.publishedAt ? { publishedAt: new Date() } : {}),
    },
  });

  notifyRevalidate(['insights']);
  return insight;
}

export async function adminDeleteInsight(fastify: FastifyInstance, id: string) {
  const insight = await fastify.prisma.insight.findUnique({ where: { id } });
  if (!insight) throw { statusCode: 404, message: 'Insight not found' };

  await fastify.prisma.insight.delete({ where: { id } });
  notifyRevalidate(['insights']);
  return { success: true };
}
