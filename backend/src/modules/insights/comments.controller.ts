import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notifyRevalidate } from '../../utils/revalidate.js';

const createSchema = z.object({
  body: z.string().trim().min(2, 'Comment is too short').max(2000, 'Comment is too long (2000 characters max)'),
});

// Shape returned to the storefront. `member` is narrowed to a display name —
// commenter email addresses must never reach a public response.
const publicSelect = {
  id: true,
  body: true,
  createdAt: true,
  memberId: true,
  member: { select: { displayName: true } },
} as const;

/** Resolves a published article by slug. Comments are addressed by article slug, not id. */
async function findPublishedInsight(fastify: FastifyInstance, slug: string) {
  const insight = await fastify.prisma.insight.findFirst({
    where: { slug, published: true },
    select: { id: true },
  });
  if (!insight) {
    throw { statusCode: 404, message: 'Insight not found' };
  }
  return insight;
}

export async function listComments(fastify: FastifyInstance, slug: string) {
  const insight = await findPublishedInsight(fastify, slug);

  const comments = await fastify.prisma.insightComment.findMany({
    where: { insightId: insight.id, hidden: false },
    // Oldest first: a comment section reads as a conversation in the order it
    // happened, unlike the article list which is newest-first.
    orderBy: { createdAt: 'asc' },
    select: publicSelect,
  });

  return { data: comments };
}

export async function createComment(
  fastify: FastifyInstance,
  slug: string,
  memberId: string,
  rawBody: unknown
) {
  const { body } = createSchema.parse(rawBody);
  const insight = await findPublishedInsight(fastify, slug);

  // Cheap double-post guard: the same member posting identical text to the
  // same article within a minute is a double-submit (impatient click, flaky
  // connection), not a second opinion. Returns the existing row so the client
  // still renders successfully instead of surfacing an error for a no-op.
  const duplicate = await fastify.prisma.insightComment.findFirst({
    where: {
      insightId: insight.id,
      memberId,
      body,
      createdAt: { gt: new Date(Date.now() - 60 * 1000) },
    },
    select: publicSelect,
  });
  if (duplicate) return duplicate;

  const comment = await fastify.prisma.insightComment.create({
    data: { insightId: insight.id, memberId, body },
    select: publicSelect,
  });

  // The article page is statically cached for up to an hour (see
  // frontend/src/lib/server-api.ts), and the comment thread is server-rendered
  // into it for indexability — without this ping a new comment would be
  // invisible to everyone but its author until that window elapsed.
  notifyRevalidate(['insights']);

  return comment;
}

export async function deleteOwnComment(fastify: FastifyInstance, id: string, memberId: string) {
  const comment = await fastify.prisma.insightComment.findUnique({
    where: { id },
    select: { id: true, memberId: true },
  });
  // Same 404 whether it never existed or belongs to someone else — a member
  // shouldn't be able to probe for other people's comment ids.
  if (!comment || comment.memberId !== memberId) {
    throw { statusCode: 404, message: 'Comment not found' };
  }

  await fastify.prisma.insightComment.delete({ where: { id } });
  notifyRevalidate(['insights']);

  return { success: true };
}
