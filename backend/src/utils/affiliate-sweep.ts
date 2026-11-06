import type { FastifyInstance } from 'fastify';
import { notifyAffiliateTeam } from './affiliate-notify.js';
import { changeNotice, NOTIFY_GAP_MS } from '../modules/affiliates/affiliate-changes.js';

/**
 * The one affiliate notice nothing triggers: the last of several details
 * changes sent close together. Each row is claimed before it is announced, so
 * it goes out once. Runs with the other two-minute sweeps in server.ts.
 */
export async function sweepAffiliateNotices(fastify: FastifyInstance): Promise<void> {
  const now = new Date();
  const held = await fastify.prisma.affiliateChangeRequest.findMany({
    where: { status: 'PENDING', notified: false, updatedAt: { lt: new Date(now.getTime() - NOTIFY_GAP_MS) } },
    select: { id: true, updatedAt: true, changes: true, previous: true, affiliate: { select: { fullName: true, discountCode: { select: { code: true } } } } },
  });
  for (const r of held) {
    // updatedAt is the version the admin decides on: this must not move it.
    const { count } = await fastify.prisma.affiliateChangeRequest.updateMany({
      where: { id: r.id, notified: false, updatedAt: r.updatedAt },
      data: { notified: true, updatedAt: r.updatedAt },
    });
    if (count) await notifyAffiliateTeam(fastify, changeNotice(r.affiliate, r.changes as Record<string, string | null>, r.previous as Record<string, string | null>, true));
  }
}
