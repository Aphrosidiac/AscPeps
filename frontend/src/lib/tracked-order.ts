/**
 * The last order this browser placed or looked up, so "Track Order" opens
 * straight onto it instead of an empty form asking for two things the
 * customer has to go and find.
 *
 * Same contract as pending-payment.ts: localStorage only, a convenience for
 * this device and never the source of truth — /track still asks the API with
 * both identifiers, exactly as if they had been typed. "Track another order"
 * forgets it.
 */

const KEY = 'ascend:tracked-order';

export interface TrackedOrderRef {
  orderNumber: string;
  phone: string;
}

export function rememberTrackedOrder(ref: TrackedOrderRef): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ref));
  } catch {
    /* private mode / blocked storage — the form still works */
  }
}

export function readTrackedOrder(): TrackedOrderRef | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const ref = JSON.parse(raw) as Partial<TrackedOrderRef>;
    if (typeof ref.orderNumber !== 'string' || typeof ref.phone !== 'string') return null;
    return { orderNumber: ref.orderNumber, phone: ref.phone };
  } catch {
    return null;
  }
}

export function forgetTrackedOrder(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
