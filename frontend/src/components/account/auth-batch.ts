import { getGroupBuysServer } from '@/lib/server-api';
import type { AuthBatch } from './AuthScreen';

/**
 * The batch a sign-in screen pitches: the one the visitor came from (its slug
 * in ?next=), else the open batch, else the next one opening. Null when no
 * batch is running, and the screen falls back to the account perks alone.
 */
export async function pickAuthBatch(next: string | undefined): Promise<AuthBatch | null> {
  const batches = (await getGroupBuysServer()).filter((b) => b.phase === 'LIVE' || b.phase === 'UPCOMING');
  const slug = next?.match(/^\/group-buy\/([^/?#]+)/)?.[1];
  const b = batches.find((x) => x.slug === slug) ?? batches.find((x) => x.phase === 'LIVE') ?? batches.find((x) => x.phase === 'UPCOMING');
  return b ? { slug: b.slug, label: b.label, title: b.title, phase: b.phase, opensAt: b.opensAt, closesAt: b.closesAt, reward: b.reward } : null;
}
