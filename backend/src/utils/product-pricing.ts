// Single source of truth for "is this product on sale, and at what price" on
// the backend. Order creation (orders.controller.ts) uses this to compute the
// price actually charged — it must never trust a client-sent price.
//
// A mirrored copy of this logic lives in frontend/src/lib/utils.ts for
// storefront display and JSON-LD generation. Keep both in sync — a sale that
// looks active on the storefront but isn't recognized here (or vice versa)
// would either overcharge or undercharge a customer relative to what they see.

export interface SalePricing {
  price: number;
  salePrice: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
}

export function isSaleActive(product: SalePricing, now: Date = new Date()): boolean {
  if (product.salePrice == null || !product.saleStartsAt || !product.saleEndsAt) return false;
  return now >= product.saleStartsAt && now <= product.saleEndsAt;
}

export function getEffectivePrice(product: SalePricing, now: Date = new Date()): number {
  return isSaleActive(product, now) ? product.salePrice! : product.price;
}
