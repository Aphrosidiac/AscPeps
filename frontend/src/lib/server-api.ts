import type { Category, PaginatedResponse, Product } from '@/types';

// Server-side data fetching for SSR/metadata. The browser talks to the API via the
// nginx-proxied relative /api path, so NEXT_PUBLIC_API_URL is empty in prod — server
// code must use an absolute origin or fetch() throws (no base URL).
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3105';

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_URL}${path}`, { next: { revalidate: 3600 } });
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
