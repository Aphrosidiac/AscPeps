// Which states count as East Malaysia, and the minimum order we require to
// ship there. Order creation (orders.controller.ts) is the enforcement point —
// it must never trust the storefront, whose state field is a dropdown but whose
// API contract is a free-text string.
//
// A mirrored copy lives in frontend/src/lib/shipping-region.ts for the checkout
// form's inline warning. Keep both in sync: a state the storefront thinks is
// Peninsular but this file thinks is East gets an order the customer was never
// warned about, rejected only after they hit Place Order.

// Labuan is grouped with Sabah and Sarawak deliberately. It is a Federal
// Territory rather than a state, so it reads like Putrajaya or KL in a
// dropdown, but it is an island off Sabah and every courier prices it on the
// East Malaysia sheet. Whatever makes the minimum worth having for Sabah makes
// it worth having here.
const EAST_MALAYSIA_STATES = ['sabah', 'sarawak', 'labuan'];

/**
 * Normalize a customer-supplied state string enough to match it reliably.
 *
 * The storefront sends exactly what's in MALAYSIAN_STATES, but this function
 * also has to cope with what people type into an API client or what an older
 * order carries: casing, padding, and the Federal Territory prefixes that
 * Labuan collects in the wild ("W.P. Labuan", "Wilayah Persekutuan Labuan").
 * Punctuation is dropped rather than mapped, so "W.P." and "WP" collapse to
 * the same thing.
 */
function normalizeState(state: string): string {
  return state
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(wilayah persekutuan|wp|negeri)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether an order to this state is subject to the East Malaysia minimum.
 *
 * Matches on containment rather than equality so that a state written as
 * "Sabah, Malaysia" or "Kota Kinabalu Sabah" still lands on the right side of
 * the rule. The three East Malaysian names share no substring with any
 * Peninsular state, so containment can't produce a false positive here.
 */
export function isEastMalaysia(state: string): boolean {
  const normalized = normalizeState(state);
  return EAST_MALAYSIA_STATES.some((s) => normalized.includes(s));
}

/**
 * The East Malaysia minimum in sen, read from the `east_malaysia_min_order`
 * setting (stored in RM, like every other money setting).
 *
 * Returns 0 — meaning "no minimum, ship anywhere freely" — for an absent,
 * blank, non-numeric or negative value. That's the safe direction for a rule
 * that only ever blocks orders: a fat-fingered setting loses us the minimum,
 * it doesn't silently close the region.
 */
export function parseEastMalaysiaMinOrder(value: string | undefined | null): number {
  if (value == null || value.trim() === '') return 0;
  const rm = parseFloat(value);
  if (!Number.isFinite(rm) || rm <= 0) return 0;
  return Math.round(rm * 100);
}

/**
 * The shipping fee in sen for an order, given the raw `shipping_fee` and
 * `east_malaysia_shipping_fee` setting values and whether the order is going
 * east. Both settings are stored in RM.
 *
 * A blank or absent East Malaysia fee falls back to the standard fee rather
 * than to free. That distinction matters on the day this ships: production has
 * no `east_malaysia_shipping_fee` row until someone creates one, and "charged
 * the Peninsular rate" is a much cheaper mistake to discover than "shipped to
 * Sabah for nothing". An East fee explicitly set to 0 still means free — that's
 * a deliberate act, not an unset value.
 */
export function resolveShippingFeeSen(
  standardValue: string | undefined | null,
  eastValue: string | undefined | null,
  goingEast: boolean
): number {
  const toSen = (value: string) => {
    // parseFloat("") is NaN, and NaN would propagate into the order total and
    // then into the amount handed to the payment gateway.
    const rm = parseFloat(value);
    return Number.isFinite(rm) && rm > 0 ? Math.round(rm * 100) : 0;
  };
  if (goingEast && eastValue != null && eastValue.trim() !== '') return toSen(eastValue);
  return standardValue != null ? toSen(standardValue) : 0;
}

/** Customer-facing rejection text. Shared so the API and the storefront agree. */
export function eastMalaysiaMinOrderMessage(minOrderSen: number): string {
  const rm = (minOrderSen / 100).toFixed(2).replace(/\.00$/, '');
  return `Orders to Sabah, Sarawak and Labuan require a minimum of RM${rm} in products. Please add more items to your cart.`;
}
