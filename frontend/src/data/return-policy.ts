/**
 * The returns policy, held in one place.
 *
 * It is stated in two spots — clause 7 of the Terms and the dedicated
 * /return-policy page — and a legal term restated in two files will drift the
 * first time someone edits one of them. Terms remains the governing document;
 * the page presents the same words in a form a customer can actually find.
 *
 * Changing this text changes the policy on both pages. It is deliberately a
 * verbatim string rather than prose assembled from parts.
 */
export const RETURN_POLICY_STATEMENT =
  'Due to the nature of our products, we do not accept returns or provide refunds once a product has been shipped, unless the product is damaged during transit or the wrong product was delivered. Claims must be made within 48 hours of receiving the order with photographic evidence.';

/** The only two situations the statement above admits a claim for. */
export const RETURN_POLICY_ELIGIBLE = [
  'The product was damaged during transit.',
  'The wrong product was delivered.',
] as const;

/** What the statement requires of a claim. Nothing here is additional policy. */
export const RETURN_POLICY_CLAIM_REQUIREMENTS = [
  'Raise the claim within 48 hours of receiving your order.',
  'Include photographic evidence of the issue.',
  'Have your order number ready so we can match it to the delivery.',
] as const;

/** Matches the Terms page, because the policy itself has not changed since. */
export const RETURN_POLICY_LAST_UPDATED = 'May 2026';
