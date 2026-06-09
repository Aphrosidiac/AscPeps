/**
 * Normalize Malaysian phone numbers to a consistent format: 01XXXXXXXXX
 *
 * Accepts any of these formats and normalizes to the same output:
 *   +60132719008  → 0132719008
 *   60132719008   → 0132719008
 *   013-271 9008  → 0132719008
 *   013 271 9008  → 0132719008
 *   0132719008    → 0132719008
 *
 * Returns the cleaned digits-only string starting with 0.
 * Returns the original trimmed input if it doesn't look like a Malaysian number
 * (so we don't silently mangle non-MY numbers).
 */
export function normalizePhone(raw: string): string {
  // Strip everything except digits
  const digits = raw.replace(/[^0-9]/g, '');

  // +60 / 60 prefix → replace with 0
  if (digits.startsWith('60') && digits.length >= 10 && digits.length <= 12) {
    return '0' + digits.slice(2);
  }

  // Already starts with 0 and is a valid MY mobile/landline length (10-11 digits)
  if (digits.startsWith('0') && digits.length >= 10 && digits.length <= 11) {
    return digits;
  }

  // Doesn't match expected MY format — return digits-only as best effort
  return digits || raw.trim();
}
