/**
 * The hosted bank-transfer page (/pay/cs_…) is reached by redirect and its
 * URL is the only credential for the session. A customer who switches to
 * their banking app, reloads, or closes the tab has no route back unless
 * they kept the confirmation email — so the storefront remembers the last
 * unfinished payment in this browser and offers a way back (PendingPaymentBar).
 *
 * localStorage only: it is a convenience for this device, never the source
 * of truth. The bar re-checks the session's live status before showing
 * anything, and forgets it the moment the session is no longer payable.
 */

const KEY = 'ascend:pending-payment';

export interface PendingPayment {
  url: string;
  orderNumber: string;
  savedAt: number;
}

export function rememberPendingPayment(p: { url: string; orderNumber: string }): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...p, savedAt: Date.now() } satisfies PendingPayment));
  } catch {
    /* private mode / blocked storage — the email link still works */
  }
}

export function readPendingPayment(): PendingPayment | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingPayment>;
    if (typeof p.url !== 'string' || typeof p.orderNumber !== 'string') return null;
    return { url: p.url, orderNumber: p.orderNumber, savedAt: typeof p.savedAt === 'number' ? p.savedAt : 0 };
  } catch {
    return null;
  }
}

export function forgetPendingPayment(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** The session id is the last path segment of the hosted page URL. */
export function sessionIdFromUrl(url: string): string | null {
  const m = /\/pay\/(cs_[A-Za-z0-9]+)/.exec(url);
  return m ? m[1] : null;
}
