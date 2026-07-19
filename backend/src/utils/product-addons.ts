// Flattens an add-on join row into a Product-shaped object: the underlying
// variant's own sellable fields, plus its parent's name/slug/category for
// display and linking, plus the join's required/quantity for this specific
// parent-add-on pairing. Shared by the public and admin product controllers.
export function flattenAddOn(row: {
  required: boolean;
  quantity: number;
  addOn: {
    id: string; code: string; size: string | null; price: number; salePrice: number | null;
    saleStartsAt: Date | null; saleEndsAt: Date | null; stock: number; imageUrl: string | null; active: boolean;
    product: { name: string; slug: string; category: { name: string; slug: string } };
  };
}) {
  const { product: addOnProduct, ...variant } = row.addOn;
  return {
    ...variant,
    name: addOnProduct.name,
    slug: addOnProduct.slug,
    category: addOnProduct.category,
    addOnRequired: row.required,
    addOnQuantity: row.quantity,
  };
}

// The include shape flattenAddOn expects — reuse identically in both
// controllers so the two never quietly drift apart.
export const ADDON_INCLUDE = {
  addOn: {
    include: {
      product: { select: { name: true, slug: true, category: { select: { name: true, slug: true } } } },
    },
  },
} as const;
