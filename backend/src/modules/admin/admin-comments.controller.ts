import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPaginationParams, paginatedResponse } from '../../utils/pagination.js';
import { notifyRevalidate } from '../../utils/revalidate.js';

const updateSchema = z.object({ hidden: z.boolean() });

// Includes what the public read deliberately omits — the commenter's email and
// ban state — because deciding whether something is spam usually means looking
// at who posted it.
const adminSelect = {
  id: true,
  body: true,
  hidden: true,
  createdAt: true,
  insight: { select: { id: true, title: true, slug: true } },
  member: { select: { id: true, displayName: true, email: true, banned: true } },
} as const;

export async function adminListComments(fastify: FastifyInstance, query: Record<string, string>) {
  const { page, limit, skip } = getPaginationParams(query);

  // ?hidden=true|false narrows to one moderation state; absent shows both.
  const where: Record<string, unknown> = {};
  if (query.hidden === 'true') where.hidden = true;
  if (query.hidden === 'false') where.hidden = false;

  const [comments, total] = await Promise.all([
    fastify.prisma.insightComment.findMany({
      where,
      // Newest first — the opposite of the public thread. This is a review
      // queue, and unreviewed spam is always the most recent thing.
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: adminSelect,
    }),
    fastify.prisma.insightComment.count({ where }),
  ]);

  return paginatedResponse(comments, total, page, limit);
}

export async function adminSetCommentHidden(fastify: FastifyInstance, id: string, body: unknown) {
  const { hidden } = updateSchema.parse(body);

  const existing = await fastify.prisma.insightComment.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw { statusCode: 404, message: 'Comment not found' };
  }

  const comment = await fastify.prisma.insightComment.update({
    where: { id },
    data: { hidden },
    select: adminSelect,
  });

  notifyRevalidate(['insights']);
  return comment;
}

export async function adminDeleteComment(fastify: FastifyInstance, id: string) {
  const existing = await fastify.prisma.insightComment.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    throw { statusCode: 404, message: 'Comment not found' };
  }

  await fastify.prisma.insightComment.delete({ where: { id } });
  notifyRevalidate(['insights']);

  return { success: true };
}

/**
 * Ban or unban the member who wrote a comment. Hiding one post does nothing
 * about someone who will simply post again — this is the lever for that.
 * Their existing comments are left alone deliberately: banning is about
 * future posts, and mass-hiding history is a separate, more destructive call
 * the admin can still make comment by comment.
 */
export async function adminSetMemberBanned(fastify: FastifyInstance, memberId: string, body: unknown) {
  const { banned } = z.object({ banned: z.boolean() }).parse(body);

  const member = await fastify.prisma.member.findUnique({ where: { id: memberId }, select: { id: true } });
  if (!member) {
    throw { statusCode: 404, message: 'Member not found' };
  }

  return fastify.prisma.member.update({
    where: { id: memberId },
    data: { banned },
    select: { id: true, displayName: true, email: true, banned: true },
  });
}
