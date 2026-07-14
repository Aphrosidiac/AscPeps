import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatPrice(priceInSen: number): string {
  return `RM${(priceInSen / 100).toFixed(2)}`;
}

/**
 * Build a product's full display name (name + size), without duplicating the
 * size when it's already embedded in the base `name` field — some catalog
 * entries store e.g. name="Glutathione 1200mg" AND size="1200mg" separately,
 * which naive concatenation renders as "Glutathione 1200mg 1200mg".
 */
export function getFullProductName(product: { name: string; size: string | null }): string {
  if (!product.size) return product.name;
  const alreadyIncluded = product.name.toLowerCase().includes(product.size.trim().toLowerCase());
  return alreadyIncluded ? product.name : `${product.name} ${product.size}`;
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
