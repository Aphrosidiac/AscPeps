import type { MetadataRoute } from 'next';
import { execSync } from 'child_process';
import path from 'path';

const BASE_URL = 'https://ascendpeptides.my';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3105';

// Real per-file last-commit date instead of build/request time (was
// `new Date()` on every static entry — all 10 shared one identical
// today-timestamp regardless of when the page actually last changed).
// Falls back to undefined (Google treats a missing lastmod as neutral,
// not as a red flag) if git history isn't available in this deployment.
function lastModifiedFromGit(relativeFilePath: string): Date | undefined {
  try {
    const iso = execSync(`git log -1 --format=%aI -- ${relativeFilePath}`, {
      cwd: path.join(process.cwd()),
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    return iso ? new Date(iso) : undefined;
  } catch {
    return undefined;
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: lastModifiedFromGit('src/app/page.tsx'), changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE_URL}/products`, lastModified: lastModifiedFromGit('src/app/products/page.tsx'), changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/about`, lastModified: lastModifiedFromGit('src/app/about/page.tsx'), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/faq`, lastModified: lastModifiedFromGit('src/app/faq/page.tsx'), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/guide`, lastModified: lastModifiedFromGit('src/app/guide/page.tsx'), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/calculator`, lastModified: lastModifiedFromGit('src/app/calculator/page.tsx'), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/coa`, lastModified: lastModifiedFromGit('src/app/coa/page.tsx'), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/shipping`, lastModified: lastModifiedFromGit('src/app/shipping/page.tsx'), changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE_URL}/terms`, lastModified: lastModifiedFromGit('src/app/terms/page.tsx'), changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE_URL}/privacy`, lastModified: lastModifiedFromGit('src/app/privacy/page.tsx'), changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE_URL}/disclaimer`, lastModified: lastModifiedFromGit('src/app/disclaimer/page.tsx'), changeFrequency: 'yearly', priority: 0.2 },
    // /track is intentionally noindex — excluded from sitemap to avoid conflicting signals.
  ];

  try {
    const res = await fetch(`${API_URL}/api/v1/products?limit=100`, { next: { revalidate: 3600 } });
    const json = await res.json();
    const products = json.data || [];

    const productPages: MetadataRoute.Sitemap = products.map((p: { slug: string; updatedAt: string }) => ({
      url: `${BASE_URL}/products/${p.slug}`,
      lastModified: new Date(p.updatedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));

    return [...staticPages, ...productPages];
  } catch {
    return staticPages;
  }
}
