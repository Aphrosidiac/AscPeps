import { env } from '../config/env.js';

/**
 * Best-effort ping to the frontend's on-demand revalidation route whenever
 * an admin create/update/delete changes product data. The storefront's
 * server-side fetches cache for up to an hour (see frontend/src/lib/server-api.ts);
 * without this, an admin save is correct in the DB immediately but invisible
 * on the live site until that window elapses. Never awaited by callers on
 * their critical path — a slow/unreachable frontend must not delay or fail
 * an admin product save.
 */
export function notifyRevalidate(): void {
  if (!env.REVALIDATE_SECRET) return;

  fetch(`${env.FRONTEND_URL}/api/revalidate`, {
    method: 'POST',
    headers: { 'x-revalidate-secret': env.REVALIDATE_SECRET },
  }).catch(() => {
    // Best-effort — the storefront falling back to its time-based cache is not an application error.
  });
}
