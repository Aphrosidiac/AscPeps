import type { MetadataRoute } from 'next';
import { execSync } from 'child_process';
import path from 'path';
import { getProductsServer, getInsightsServer } from '@/lib/server-api';

const BASE_URL = 'https://ascendpeptides.my';

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
    { url: `${BASE_URL}/insights`, lastModified: lastModifiedFromGit('src/app/insights/page.tsx'), changeFrequency: 'weekly', priority: 0.7 },
    { url: `${BASE_URL}/about`, lastModified: lastModifiedFromGit('src/app/about/page.tsx'), changeFrequency: 'monthly', priority: 0.5 },
    { url: `${BASE_URL}/faq`, lastModified: lastModifiedFromGit('src/app/faq/page.tsx'), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/guide`, lastModified: lastModifiedFromGit('src/app/guide/page.tsx'), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/calculator`, lastModified: lastModifiedFromGit('src/app/calculator/page.tsx'), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${BASE_URL}/coa`, lastModified: lastModifiedFromGit('src/app/coa/page.tsx'), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${BASE_URL}/shipping`, lastModified: lastModifiedFromGit('src/app/shipping/page.tsx'), changeFrequency: 'monthly', priority: 0.4 },
    { url: `${BASE_URL}/terms`, lastModified: lastModifiedFromGit('src/app/terms/page.tsx'), changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE_URL}/privacy`, lastModified: lastModifiedFromGit('src/app/privacy/page.tsx'), changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE_URL}/disclaimer`, lastModified: lastModifiedFromGit('src/app/disclaimer/page.tsx'), changeFrequency: 'yearly', priority: 0.2 },
    { url: `${BASE_URL}/return-policy`, lastModified: lastModifiedFromGit('src/app/return-policy/page.tsx'), changeFrequency: 'yearly', priority: 0.3 },
    // /track is intentionally noindex — excluded from sitemap to avoid conflicting signals.
  ];

  try {
    const [{ data: products }, { data: insights }] = await Promise.all([
      getProductsServer({ limit: 100 }),
      getInsightsServer({ limit: 100 }),
    ]);

    const productPages: MetadataRoute.Sitemap = products.map((p) => ({
      url: `${BASE_URL}/products/${p.slug}`,
      lastModified: new Date(p.updatedAt),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }));

    const insightPages: MetadataRoute.Sitemap = insights.map((i) => ({
      url: `${BASE_URL}/insights/${i.slug}`,
      lastModified: new Date(i.updatedAt),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }));

    return [...staticPages, ...productPages, ...insightPages];
  } catch {
    return staticPages;
  }
}
