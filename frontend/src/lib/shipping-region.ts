// Storefront copy of the East Malaysia shipping rule. This drives the checkout
// form's inline warning only — the real gate is backend/src/utils/
// shipping-region.ts, which order creation enforces against a subtotal it
// computes itself.
//
// Keep the two in sync. If this file thinks a state is Peninsular and the
// backend thinks it's East, the customer fills in the whole form, hits Place
// Order and gets rejected by the server for a rule nothing warned them about.

// Labuan sits here with Sabah and Sarawak: it reads like a Federal Territory in
// the dropdown, but it's an island off Sabah and couriers price it on the East
// Malaysia sheet. See the backend file for the full reasoning.
const EAST_MALAYSIA_STATES = ['sabah', 'sarawak', 'labuan'];

/**
 * Whether an order to this state is subject to the East Malaysia minimum.
 *
 * The dropdown only ever produces exact MALAYSIAN_STATES values, so the
 * normalization here is lighter than the backend's — it exists so the two
 * files agree on the plain cases, not to parse hand-typed input.
 */
export function isEastMalaysia(state: string): boolean {
  const normalized = state.toLowerCase().trim();
  return EAST_MALAYSIA_STATES.some((s) => normalized.includes(s));
}

/**
 * The minimum in sen from the public `east_malaysia_min_order` setting (stored
 * in RM). 0 means no minimum — matching the backend, which treats an absent,
 * blank or nonsensical value as "the rule is off" rather than as a block.
 */
export function parseEastMalaysiaMinOrder(value: string | undefined): number {
  if (!value || value.trim() === '') return 0;
  const rm = parseFloat(value);
  if (!Number.isFinite(rm) || rm <= 0) return 0;
  return Math.round(rm * 100);
}

/**
 * Whether an East Malaysia minimum is actually in force. Blank, zero or
 * non-numeric all mean "no minimum" — matching parseEastMalaysiaMinOrder and
 * the server.
 */
export function hasEastMinimum(value: string | undefined): boolean {
  return parseEastMalaysiaMinOrder(value) > 0;
}

/**
 * Whether the East Malaysia fee is genuinely different from the standard one,
 * and therefore worth stating separately in customer-facing copy and in the
 * product schema.
 *
 * Compared numerically, not as strings: an admin who types "10" against a
 * standard fee stored as "10.0" means the same fee, and a string comparison
 * would have every policy page redundantly announce an East Malaysia rate
 * identical to the one it just quoted — and make the product schema emit two
 * shipping entries carrying the same number.
 */
export function eastFeeDiffers(standardValue: string | undefined, eastValue: string | undefined): boolean {
  if (!eastValue || eastValue.trim() === '') return false;
  return resolveShippingFeeSen(standardValue, eastValue, true) !== resolveShippingFeeSen(standardValue, eastValue, false);
}

/**
 * The shipping fee in sen to display, from the raw `shipping_fee` and
 * `east_malaysia_shipping_fee` settings. Mirrors resolveShippingFeeSen in
 * backend/src/utils/shipping-region.ts — including the rule that a blank East
 * fee falls back to the standard one rather than to free, so the summary can
 * never quote a total the server won't honour.
 */
export function resolveShippingFeeSen(
  standardValue: string | undefined,
  eastValue: string | undefined,
  goingEast: boolean
): number {
  const toSen = (value: string) => {
    const rm = parseFloat(value);
    return Number.isFinite(rm) && rm > 0 ? Math.round(rm * 100) : 0;
  };
  if (goingEast && eastValue != null && eastValue.trim() !== '') return toSen(eastValue);
  return standardValue != null ? toSen(standardValue) : 0;
}
