import { env } from '../config/env.js';

/**
 * Best-effort ping to the frontend's on-demand revalidation route whenever
 * an admin create/update/delete changes product (or other tagged) data. The
 * storefront's server-side fetches cache for up to an hour (see
 * frontend/src/lib/server-api.ts); without this, an admin save is correct in
 * the DB immediately but invisible on the live site until that window
 * elapses. Never awaited by callers on their critical path — a slow/
 * unreachable frontend must not delay or fail an admin save.
 */
export function notifyRevalidate(tags: string[] = ['products']): void {
  if (!env.REVALIDATE_SECRET) return;

  const base = env.FRONTEND_INTERNAL_URL || env.FRONTEND_URL;
  fetch(`${base}/api/revalidate`, {
    method: 'POST',
    headers: { 'x-revalidate-secret': env.REVALIDATE_SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  }).catch(() => {
    // Best-effort — the storefront falling back to its time-based cache is not an application error.
  });
}
