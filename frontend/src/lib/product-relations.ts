import type { Product } from '@/types';

// Strips trailing digits off a variant code (e.g. "BP10"/"BP40" -> "BP").
// Was also used to recover same-compound size families before the
// parent/variant rework gave that relationship a real, persisted home — its
// only remaining caller is getRecommendedSolvent below.
function baseCode(code: string): string {
  return code.replace(/\d+$/, '');
}

export function getRelatedProducts(product: Product, all: Product[], excludeIds: Set<string>, limit = 4): Product[] {
  return all
    .filter((p) => p.id !== product.id && p.categoryId === product.categoryId && !excludeIds.has(p.id))
    .slice(0, limit);
}

// No "commonly paired" data field exists on Product — this is an explicit,
// hand-maintained business rule rather than an inferred heuristic. Slugs
// here are parent-product slugs (post-rework, a size no longer has its own
// slug) — "Bac Water"'s two sizes collapsed into one "bac-water" entry.
const PAIRED_SUPPLY_SLUGS: Record<string, string[]> = {
  'skin-anti-aging': ['acetic-acid', 'bac-water'],
};
const DEFAULT_PAIRED_SUPPLY_SLUGS = ['bac-water'];

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
  // Every variant of a given product line shares the same code prefix (that's
  // literally how the parent/variant migration grouped them) — any variant's
  // code works here, so just use the first one.
  const code = product.variants[0]?.code ?? '';
  return baseCode(code) === 'CU' ? 'acetic-acid' : 'bac-water';
}
