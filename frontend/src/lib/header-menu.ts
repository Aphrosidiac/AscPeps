import type { Category, Product, ResearchListItem } from '@/types';

/**
 * What the header's menus show, built on the server from the live catalogue
 * (components/layout/HeaderMenus.tsx draws it). Only what exists: categories
 * with products, a featured product that has a photo, the latest research.
 */
export interface HeaderMenuData {
  categories: { name: string; slug: string }[];
  /** "Supplies" (BAC water, syringes): its own link, not a goal. */
  supplies: { name: string; slug: string } | null;
  feature: { name: string; code: string; slug: string; imageUrl: string; fromPrice: number } | null;
  research: { slug: string; title: string; dek: string }[];
}

export function headerMenu(categories: Category[], products: Product[], research: ResearchListItem[]): HeaderMenuData {
  const live = categories.filter((c) => c.productCount > 0);
  const withPhoto = products
    .map((p) => {
      const sizes = p.variants.filter((v) => v.active);
      const photo = sizes.find((v) => v.imageUrl)?.imageUrl;
      return photo && sizes.length ? { p, photo, from: Math.min(...sizes.map((v) => v.price)), code: sizes[0].code } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const pick = withPhoto.find((x) => x.p.featured) ?? withPhoto[0];
  return {
    categories: live.filter((c) => c.slug !== 'supplies').map((c) => ({ name: c.name, slug: c.slug })),
    supplies: live.find((c) => c.slug === 'supplies') ?? null,
    feature: pick ? { name: pick.p.name, code: pick.code, slug: pick.p.slug, imageUrl: pick.photo, fromPrice: pick.from } : null,
    research: research.slice(0, 3).map((r) => ({ slug: r.slug, title: r.title, dek: r.dek })),
  };
}
