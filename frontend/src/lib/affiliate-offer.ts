/**
 * Ascend Affiliate as the store advertises it: the live numbers from the
 * settings, or null while the programme is off — so every place that promotes
 * it (popup, homepage, order success, account, footer) shows the same offer
 * and disappears together.
 */
export interface AffiliateOffer {
  /** What the code takes off for the customer, in whole percent. */
  discountPct: number;
  /** "5%" — the default commission. */
  commission: string;
  rateBps: number;
}

export function affiliateOffer(settings: Record<string, string>): AffiliateOffer | null {
  if (settings.affiliate_enabled !== 'true') return null;
  const rateBps = Number(settings.affiliate_default_rate_bps || 500);
  return {
    discountPct: Number(settings.affiliate_customer_discount_pct || 5),
    commission: `${rateBps / 100}%`,
    rateBps,
  };
}
