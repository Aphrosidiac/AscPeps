import { GROUP_BUY_ENABLED } from '@/lib/features';
import type { Category, PaginatedResponse, Product, Insight, InsightComment, ResearchArticle, ResearchListItem } from '@/types';

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

export const getResearchListServer = () =>
  getJson<{ data: ResearchListItem[] }>(`/api/v1/research`, { data: [] }, ['research']);

/** The live article; or where its URL went (a rename or delete leaves a 301 or "gone"); or nothing. */
export async function getResearchServer(slug: string): Promise<
  { article: ResearchArticle } | { redirect: string } | { gone: true } | null
> {
  try {
    const res = await fetch(`${API_URL}/api/v1/research/${encodeURIComponent(slug)}`, { next: { revalidate: 3600, tags: ['research'] } });
    if (res.ok) return { article: (await res.json()) as ResearchArticle };
    const body = (await res.json().catch(() => null)) as { details?: { path: string; message: string }[] } | null;
    const moved = body?.details?.[0];
    if (moved?.path === 'redirect') return { redirect: moved.message };
    if (moved?.path === 'gone') return { gone: true };
    return null;
  } catch {
    return null;
  }
}

// Group Buy — short cache: the joined counter and batch phase move in minutes.
export const getGroupBuysServer = async () =>
  GROUP_BUY_ENABLED ? getJsonFresh<import('@/types').GroupBuySummary[]>(`/api/v1/group-buys`, []) : [];

export const getGroupBuyServer = async (slug: string) =>
  GROUP_BUY_ENABLED ? getJsonFresh<import('@/types').GroupBuyDetail | null>(`/api/v1/group-buys/${encodeURIComponent(slug)}`, null) : null;

export const getGroupBuyPromoServer = async (): Promise<import('@/types').GroupBuyPromo> =>
  GROUP_BUY_ENABLED ? getJsonFresh(`/api/v1/group-buys/promo`, { banner: null, popup: null, home: null }) : { banner: null, popup: null, home: null };

async function getJsonFresh<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_URL}${path}`, { next: { revalidate: 60, tags: ['group-buys'] } });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}
