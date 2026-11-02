/**
 * Where Ascend Affiliate lives: the subdomain in a production build, the same
 * pages under /affiliate on the store's host in development (or wherever
 * NEXT_PUBLIC_AFFILIATE_URL says).
 */
export const AFFILIATE_URL =
  process.env.NEXT_PUBLIC_AFFILIATE_URL ||
  (process.env.NODE_ENV === 'production' ? 'https://affiliate.ascendpeptides.my' : '/affiliate');
