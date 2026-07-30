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
  // Sent as the complete, ordered list — array position IS the figure number,
  // so the client never has to compute or send `order` itself. Omitting the key
  // entirely leaves existing figures alone; sending [] clears them.
  figures: z
    .array(
      z.object({
        imageUrl: z.string().min(1),
        caption: z.string().trim().min(1, 'Caption is required').max(500),
        altText: z.string().trim().max(300).optional(),
        credit: z.string().trim().max(300).nullable().optional(),
        creditUrl: z.string().trim().max(500).nullable().optional(),
      })
    )
    .max(20)
    .optional(),
});

const createInsightSchema = insightObjectSchema;
const updateInsightSchema = insightObjectSchema.partial();

type FigureInput = NonNullable<z.infer<typeof insightObjectSchema>['figures']>;

// Figures are replaced wholesale rather than diffed: they're only meaningful as
// an ordered set (the position is the printed number), and their ids mean
// nothing to anything else. `order` is derived from array position here so the
// number a reader sees can never disagree with the order they were sent in.
function figureCreateData(figures: FigureInput) {
  return figures.map((figure, index) => ({
    order: index + 1,
    imageUrl: figure.imageUrl,
    caption: figure.caption,
    altText: figure.altText ?? '',
    credit: figure.credit ?? null,
    creditUrl: figure.creditUrl ?? null,
  }));
}

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
  const insight = await fastify.prisma.insight.findUnique({
    where: { id },
    include: { figures: { orderBy: { order: 'asc' } } },
  });
  if (!insight) throw { statusCode: 404, message: 'Insight not found' };
  return insight;
}

export async function adminCreateInsight(fastify: FastifyInstance, body: unknown) {
  const { figures, ...data } = createInsightSchema.parse(body);

  const insight = await fastify.prisma.insight.create({
    data: {
      ...data,
      readTimeMinutes: estimateReadTime(data.content),
      publishedAt: data.published ? new Date() : null,
      ...(figures && figures.length > 0 ? { figures: { create: figureCreateData(figures) } } : {}),
    },
    include: { figures: { orderBy: { order: 'asc' } } },
  });

  notifyRevalidate(['insights']);
  return insight;
}

export async function adminUpdateInsight(fastify: FastifyInstance, id: string, body: unknown) {
  const { figures, ...data } = updateInsightSchema.parse(body);

  const existing = await fastify.prisma.insight.findUnique({ where: { id } });
  if (!existing) throw { statusCode: 404, message: 'Insight not found' };

  // Delete-then-recreate inside one transaction. Without the transaction a
  // failure partway would leave the article with no figures at all, and the
  // (insightId, order) unique index makes an in-place reorder impossible to do
  // safely row by row anyway — swapping two figures would collide mid-update.
  const insight = await fastify.prisma.$transaction(async (tx) => {
    if (figures !== undefined) {
      await tx.insightFigure.deleteMany({ where: { insightId: id } });
      if (figures.length > 0) {
        await tx.insightFigure.createMany({
          data: figureCreateData(figures).map((f) => ({ ...f, insightId: id })),
        });
      }
    }

    return tx.insight.update({
      where: { id },
      data: {
        ...data,
        ...(data.content !== undefined ? { readTimeMinutes: estimateReadTime(data.content) } : {}),
        ...(data.published && !existing.publishedAt ? { publishedAt: new Date() } : {}),
      },
      include: { figures: { orderBy: { order: 'asc' } } },
    });
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
