import type { Category, PaginatedResponse, Product, Insight, InsightComment } from '@/types';

// Server-side data fetching for SSR/metadata. The browser talks to the API via the
// nginx-proxied relative /api path, so NEXT_PUBLIC_API_URL is empty in prod — server
// code must use an absolute origin or fetch() throws (no base URL).
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3105';

async function getJson<T>(path: string, fallback: T, tags: string[] = ['products']): Promise<T> {
  try {
    // Tagged so the backend can trigger immediate invalidation via
    // /api/revalidate after an admin save — see backend/src/utils/revalidate.ts.
    // revalidate: 3600 stays as the fallback ceiling if that ping never arrives.
    const res = await fetch(`${API_URL}${path}`, { next: { revalidate: 3600, tags } });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export const getProductServer = (slug: string) =>
  getJson<Product | null>(`/api/v1/products/${encodeURIComponent(slug)}`, null);

export const getSettingsServer = () =>
  getJson<Record<string, string>>(`/api/v1/settings`, {});

export const getCategoriesServer = () => getJson<Category[]>(`/api/v1/categories`, []);

export const getProductsServer = (params?: {
  limit?: number;
  category?: string;
  search?: string;
  featured?: boolean;
}) => {
  const query: Record<string, string> = {};
  if (params?.limit) query.limit = String(params.limit);
  if (params?.category) query.category = params.category;
  if (params?.search) query.search = params.search;
  if (params?.featured) query.featured = 'true';

  return getJson<PaginatedResponse<Product>>(
    `/api/v1/products?${new URLSearchParams(query).toString()}`,
    { data: [], pagination: { page: 1, limit: 0, total: 0, totalPages: 0 } }
  );
};

export const getInsightsServer = (params?: { category?: string; limit?: number }) => {
  const query: Record<string, string> = { limit: String(params?.limit ?? 100) };
  if (params?.category) query.category = params.category;

  return getJson<PaginatedResponse<Insight>>(
    `/api/v1/insights?${new URLSearchParams(query).toString()}`,
    { data: [], pagination: { page: 1, limit: 0, total: 0, totalPages: 0 } },
    ['insights']
  );
};

export const getInsightServer = (slug: string) =>
  getJson<Insight | null>(`/api/v1/insights/${encodeURIComponent(slug)}`, null, ['insights']);

// Fetched server-side (rather than in the browser after hydration) so the
// comments are in the HTML crawlers receive — reader discussion is exactly the
// long-tail content this section exists to accumulate. Shares the 'insights'
// tag, so posting a comment revalidates the article page it lives on; see the
// notifyRevalidate call in the backend's comments controller.
export const getInsightCommentsServer = (slug: string) =>
  getJson<{ data: InsightComment[] }>(
    `/api/v1/insights/${encodeURIComponent(slug)}/comments`,
    { data: [] },
    ['insights']
  );
