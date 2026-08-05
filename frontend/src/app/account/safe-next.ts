const DEFAULT_NEXT = '/insights';

/**
 * Constrains the `?next=` post-sign-in redirect to a path on this site.
 *
 * The param arrives from the URL bar, so it is attacker-controlled: a link to
 * /account/login?next=https://evil.example would otherwise hand someone a
 * credible ascendpeptides.my sign-in page that bounces them somewhere else the
 * moment it succeeds. Only a single-slash-prefixed relative path is accepted —
 * note the second check, which rejects the protocol-relative "//evil.example"
 * form that browsers resolve as an absolute URL despite starting with "/".
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value) return DEFAULT_NEXT;
  if (!value.startsWith('/')) return DEFAULT_NEXT;
  if (value.startsWith('//')) return DEFAULT_NEXT;
  // Backslashes are normalised to forward slashes by some browsers, so "/\evil"
  // is another way to write a protocol-relative URL.
  if (value.startsWith('/\\')) return DEFAULT_NEXT;
  return value;
}
