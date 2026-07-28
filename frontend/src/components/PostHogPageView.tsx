'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import posthog from 'posthog-js';

/**
 * Captures $pageview on first mount and on every client-side route change.
 *
 * Why manual, when PostHog's docs say `defaults: '2026-05-30'` makes it
 * automatic: against THIS project, it doesn't. Isolated by running identical
 * code and changing only the project token —
 *
 *   fake token  (remote config fails to load) -> $pageview fires
 *   real token  (remote config loads)         -> $pageview never fires
 *
 * — with every event reaching before_send logged, on both localhost and
 * production, with and without the /ingest reverse proxy. Autocapture,
 * $pageleave and custom events kept working throughout, which is why PostHog's
 * Installation Health showed "4 of 6 checks passed" while recording no
 * pageviews at all. A manual posthog.capture('$pageview') was always accepted
 * (HTTP 200 {"status":"Ok"}), so only the automatic trigger was affected.
 *
 * capture_pageview is pinned to false in instrumentation-client so this stays
 * the single source of pageviews — if a PostHog change ever re-enables the
 * automatic one, that pin is what stops every pageview being counted twice.
 *
 * Deliberately keyed on usePathname() ONLY, not useSearchParams(): reading
 * search params in a client component opts the whole route out of static
 * rendering unless wrapped in Suspense, and this site's SEO recovery
 * (51 -> 81) depends on those pages staying server-rendered. The cost is that
 * a navigation changing only the query string isn't a new pageview — fine
 * here, as no indexed route varies by query string, and before_send strips
 * query strings on /checkout and /track anyway.
 */
export function PostHogPageView() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;
    // No explicit $current_url — let PostHog read it from the DOM so it can't
    // disagree with what before_send sanitises on /checkout and /track.
    posthog.capture('$pageview');
  }, [pathname]);

  return null;
}
