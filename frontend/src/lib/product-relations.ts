import type { Product } from '@/types';

// Groups by product code with trailing digits stripped (e.g. "BP10"/"BP40" -> "BP"),
// cross-checked by category. This recovers same-compound size families even when
// name/slug spelling drifts (e.g. epitalon-10mg vs epithalon-50mg both use code
// prefix "ET") — a plain name/slug string match misses that pairing entirely.
function baseCode(code: string): string {
  return code.replace(/\d+$/, '');
}

export function getSizeVariants(product: Product, all: Product[]): Product[] {
  const base = baseCode(product.code);
  if (!base) return [];
  return all
    .filter((p) => p.id !== product.id && p.categoryId === product.categoryId && baseCode(p.code) === base)
    .sort((a, b) => (parseFloat(a.size ?? '') || 0) - (parseFloat(b.size ?? '') || 0));
}

export function getRelatedProducts(product: Product, all: Product[], excludeIds: Set<string>, limit = 4): Product[] {
  return all
    .filter((p) => p.id !== product.id && p.categoryId === product.categoryId && !excludeIds.has(p.id))
    .slice(0, limit);
}

// No "commonly paired" data field exists on Product — this is an explicit,
// hand-maintained business rule rather than an inferred heuristic.
const PAIRED_SUPPLY_SLUGS: Record<string, string[]> = {
  'skin-anti-aging': ['acetic-acid-10ml', 'bac-water-3ml', 'bac-water-10ml'],
};
const DEFAULT_PAIRED_SUPPLY_SLUGS = ['bac-water-3ml', 'bac-water-10ml'];

// Categories that are entirely liquid/ready-to-use products (confirmed against
// the live catalog — "Health Boosters" is PDRN/Ginkgo/ALA/Vitamin C/Glutathione/
// Multi-Minerals, "Testosterone" is the two testosterone esters). Used as a
// fallback classification for products whose dosageInfo isn't published yet;
// once dosageInfo is live, the per-product text is the source of truth.
const LIQUID_ONLY_CATEGORIES = new Set(['health-boosters', 'testosterone']);

// Matches the phrasing used consistently across every dosageInfo we've written
// (see ascendpeptides.my-audit/PHASE4-CONTENT-DRAFT*.md).
function isLikelyLiquid(product: Product): boolean {
  const info = product.dosageInfo?.toLowerCase() ?? '';
  if (info.includes('no reconstitution required')) return true;
  if (info.includes('reconstitute')) return false;
  return LIQUID_ONLY_CATEGORIES.has(product.category.slug);
}

export function getPairedSupplies(product: Product, all: Product[], excludeIds: Set<string>): Product[] {
  if (product.category.slug === 'supplies' || isLikelyLiquid(product)) return [];
  const slugs = PAIRED_SUPPLY_SLUGS[product.category.slug] ?? DEFAULT_PAIRED_SUPPLY_SLUGS;
  return all.filter((p) => slugs.includes(p.slug) && !excludeIds.has(p.id));
}

// Avoids showing reconstitution instructions on liquid/ready-to-use product pages.
export function needsReconstitutionGuide(product: Product): boolean {
  if (product.category.slug === 'supplies') return false;
  if (!product.dosageInfo) return false;
  return !isLikelyLiquid(product);
}

export function getRecommendedSolvent(product: Product): 'acetic-acid' | 'bac-water' {
  return baseCode(product.code) === 'CU' ? 'acetic-acid' : 'bac-water';
}
