import type { NextConfig } from "next";
import productRedirects from "./src/data/product-redirects.json";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3105";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Inlines the small (~11KB) atomic Tailwind CSS bundle into <head>
    // instead of a render-blocking <link>, per the performance audit's
    // finding that it cost 120-157ms on every page load. Production-only —
    // no effect in dev.
    inlineCss: true,
  },
  async rewrites() {
    // next/image's optimizer resolves a relative src by fetching it from
    // this Next server itself, not through nginx — and this server has no
    // /uploads route of its own (only the backend does), so every uploaded
    // product photo 400'd with "isn't a valid image ... received null".
    // Proxying the same path to the backend fixes both that internal fetch
    // and any direct browser request to /uploads/*.
    // PostHog's /ingest proxy is deliberately NOT here — it's an nginx
    // location block instead (see docs/posthog.md). Proxying it through Next
    // would put analytics traffic through a Node process on a memory-tight
    // box, and would require `skipTrailingSlashRedirect: true`, which changes
    // URL canonicalisation for every route on the site.
    return [{ source: "/uploads/:path*", destination: `${API_URL}/uploads/:path*` }];
  },
  async redirects() {
    // One entry per pre-rework per-size product URL (e.g.
    // /products/retatrutide-30mg), generated once by
    // backend/scripts/migrate-products-to-variants.mjs during the
    // parent/variant migration — 301s preserve SEO equity from the old,
    // separately-indexed per-size pages onto the new single parent page
    // (e.g. /products/retatrutide) where all sizes now live together.
    // These migration targets were never published and 404 live — until (if)
    // those products go live, send their old URLs to the products listing
    // instead: a 301 to a live listing beats a 301 into a 404. Repoint back
    // to `/products/<slug>` if any of these are ever published.
    const unpublishedTargets = new Set([
      "humanin",
      "human-placenta-extract",
      "ghkcu-bpc157-tb500-kpv",
      "reconstitution-syringe",
      "syringe",
    ]);
    return Object.entries(productRedirects as Record<string, string>).map(([from, to]) => ({
      source: `/products/${from}`,
      destination: unpublishedTargets.has(to) ? "/products" : `/products/${to}`,
      permanent: true,
    }));
  },
};

export default nextConfig;
