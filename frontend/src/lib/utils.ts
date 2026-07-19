import { clsx, type ClassValue } from 'clsx';
import type { Product, ProductVariant } from '@/types';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatPrice(priceInSen: number): string {
  return `RM${(priceInSen / 100).toFixed(2)}`;
}

// Composes a variant's display name from its parent's name + its own size
// label (e.g. "Retatrutide" + "30mg" -> "Retatrutide 30mg"). Unlike the old
// flat model, `name` never bakes in size here, so no dedup check is needed.
export function getVariantDisplayName(product: { name: string }, variant: { size: string | null }): string {
  return variant.size ? `${product.name} ${variant.size}` : product.name;
}

// The variant shown by default on a product card / on first paint of the
// product page — the lowest-priced active variant. Used identically in both
// places so they never disagree about which size is "the" default.
export function getDefaultVariant(product: Product): ProductVariant | null {
  const active = product.variants.filter((v) => v.active);
  if (active.length === 0) return null;
  return active.reduce((min, v) => (v.price < min.price ? v : min));
}

const SITE_URL = 'https://ascendpeptides.my';

/**
 * Resolve a product/asset image path to an absolute URL. Uploaded product
 * images are stored as site-relative paths (`/uploads/products/...`), which
 * resolve fine in <img>/<Image> tags but are invalid in JSON-LD/OG metadata,
 * which require a fully-qualified URL.
 */
export function absoluteImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${SITE_URL}${url.startsWith('/') ? url : `/${url}`}`;
}

// Single source of truth for "is this product on sale, and at what price" on
// the frontend — storefront display and JSON-LD generation. A mirrored copy
// of this logic lives in backend/src/utils/product-pricing.ts, which is what
// actually determines the price charged at checkout. Keep both in sync — a
// sale that looks active here but isn't recognized there (or vice versa)
// would show a price the customer isn't actually charged.
export interface SalePricing {
  price: number;
  salePrice: number | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
}

export function isSaleActive(product: SalePricing, now: Date = new Date()): boolean {
  if (product.salePrice == null || !product.saleStartsAt || !product.saleEndsAt) return false;
  const start = new Date(product.saleStartsAt);
  const end = new Date(product.saleEndsAt);
  return now >= start && now <= end;
}

export function getEffectivePrice(product: SalePricing, now: Date = new Date()): number {
  return isSaleActive(product, now) ? product.salePrice! : product.price;
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-MY', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Normalize Malaysian phone numbers to digits-only format: 01XXXXXXXXX
 * Handles: +60132719008, 60132719008, 013-271 9008, 013 271 9008, etc.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.startsWith('60') && digits.length >= 10 && digits.length <= 12) {
    return '0' + digits.slice(2);
  }
  if (digits.startsWith('0') && digits.length >= 10 && digits.length <= 11) {
    return digits;
  }
  return digits || raw.trim();
}
