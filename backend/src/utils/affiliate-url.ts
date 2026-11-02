import { env } from '../config/env.js';

/** Where the affiliate portal lives, for links in emails. */
export function affiliatePortalUrl(): string {
  if (env.AFFILIATE_URL) return env.AFFILIATE_URL.replace(/\/$/, '');
  const store = env.FRONTEND_URL.replace(/\/$/, '');
  return /localhost|127\.0\.0\.1/.test(store) ? `${store}/affiliate` : 'https://affiliate.ascendpeptides.my';
}
