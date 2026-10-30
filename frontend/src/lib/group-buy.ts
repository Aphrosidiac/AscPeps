import { useMemo, useSyncExternalStore } from 'react';
import type { GroupBuyItem, GroupBuyReward, GroupBuyTier } from '@/types';

/**
 * Group Buy pricing on the client — the same rules as backend/src/utils/group-buy.ts,
 * so the batch page shows exactly what checkout will charge. The server re-checks all of it.
 */

export function sortTiers(tiers: GroupBuyTier[]): GroupBuyTier[] {
  return [...tiers].sort((a, b) => a.minQty - b.minQty);
}

export function tierFor(tiers: GroupBuyTier[], qty: number): GroupBuyTier | null {
  let hit: GroupBuyTier | null = null;
  for (const t of sortTiers(tiers)) if (qty >= t.minQty) hit = t;
  return hit;
}

export function vialsPerUnit(item: Pick<GroupBuyItem, 'sellUnit' | 'packSize'>): number {
  return item.sellUnit === 'KIT' ? Math.max(item.packSize, 1) : 1;
}

export function unitWord(item: Pick<GroupBuyItem, 'sellUnit' | 'unitLabel'>, qty = 1): string {
  if (item.unitLabel?.trim()) return item.unitLabel.trim();
  const base = item.sellUnit === 'KIT' ? 'kit' : 'vial';
  return qty === 1 ? base : `${base}s`;
}

/** "Kit of 10 vials" / "Per vial". */
export function unitDescription(item: Pick<GroupBuyItem, 'sellUnit' | 'packSize' | 'unitLabel'>): string {
  if (item.sellUnit === 'KIT') return `${item.unitLabel?.trim() || 'Kit'} of ${item.packSize} vials`;
  return item.unitLabel?.trim() ? `Per ${item.unitLabel.trim()}` : 'Per vial';
}

/** "1–4" / "10+" for a tier within its list. */
export function tierRange(tiers: GroupBuyTier[], t: GroupBuyTier): string {
  const next = sortTiers(tiers).find((x) => x.minQty > t.minQty);
  return next ? (next.minQty - 1 === t.minQty ? `${t.minQty}` : `${t.minQty}–${next.minQty - 1}`) : `${t.minQty}+`;
}

/** Why this quantity is not allowed, or null. qty 0 = not chosen (allowed). */
export function itemProblem(item: GroupBuyItem, qty: number): string | null {
  if (qty === 0) return null;
  if (qty < item.minQty) return `Minimum ${item.minQty} ${unitWord(item, item.minQty)}`;
  if (item.maxQty != null && qty > item.maxQty) return `Up to ${item.maxQty} ${unitWord(item, item.maxQty)} per order`;
  const tier = tierFor(item.tiers, qty);
  if (!tier) return 'No price for this quantity';
  if (item.minAmount != null && tier.price * qty < item.minAmount) return `Minimum RM${(item.minAmount / 100).toFixed(0)} on this product`;
  return null;
}

export interface BasketLine {
  item: GroupBuyItem;
  qty: number;
  tier: GroupBuyTier | null;
  total: number;
  /** What the same vials cost in the store today. */
  storeTotal: number;
  problem: string | null;
  /** The next tier up and how many more units reach it. */
  next: { tier: GroupBuyTier; more: number } | null;
}

export function basketLines(items: GroupBuyItem[], qtys: Record<string, number>): BasketLine[] {
  return items.map((item) => {
    const qty = qtys[item.variantId] ?? 0;
    const tier = qty > 0 ? tierFor(item.tiers, qty) : null;
    const nextTier = sortTiers(item.tiers).find((t) => t.minQty > Math.max(qty, 0));
    return {
      item,
      qty,
      tier,
      total: tier ? tier.price * qty : 0,
      storeTotal: item.storePrice * vialsPerUnit(item) * qty,
      problem: itemProblem(item, qty),
      next: nextTier && qty > 0 ? { tier: nextTier, more: nextTier.minQty - qty } : null,
    };
  });
}

/** "Join the list and get 10% off your batch order". */
export function rewardHeadline(r: GroupBuyReward): string {
  if (r.headline?.trim()) return r.headline.trim();
  const off = r.type === 'PERCENTAGE' ? `${r.value}% off` : `RM${(r.value / 100).toFixed(2).replace(/\.00$/, '')} off`;
  const where = r.scope === 'GROUP_BUY' ? 'your batch order' : r.scope === 'STORE' ? 'your next store order' : 'your next order';
  return `Join the list and get ${off} ${where}`;
}

export function rewardOff(r: Pick<GroupBuyReward, 'type' | 'value'>): string {
  return r.type === 'PERCENTAGE' ? `${r.value}% off` : `RM${(r.value / 100).toFixed(2).replace(/\.00$/, '')} off`;
}

// ─── The basket, per batch, kept in this browser ────────────────────────────

const key = (slug: string) => `ascend-gb-basket:${slug}`;
// Same-tab listeners: the native `storage` event only reaches other tabs.
const BASKET_EVENT = 'ascend-gb-basket-change';

function parseBasket(raw: string | null): Record<string, number> {
  try {
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function rawBasket(slug: string): string {
  try { return localStorage.getItem(key(slug)) ?? ''; } catch { return ''; }
}

export function readBasket(slug: string): Record<string, number> {
  return parseBasket(rawBasket(slug));
}

export function writeBasket(slug: string, qtys: Record<string, number>): void {
  try {
    const clean = Object.fromEntries(Object.entries(qtys).filter(([, q]) => q > 0));
    localStorage.setItem(key(slug), JSON.stringify(clean));
  } catch { /* private mode */ }
  window.dispatchEvent(new Event(BASKET_EVENT));
}

export function clearBasket(slug: string): void {
  try { localStorage.removeItem(key(slug)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(BASKET_EVENT));
}

function subscribeBasket(onChange: () => void) {
  window.addEventListener(BASKET_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(BASKET_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * The batch's basket, live. Null on the server and during hydration (the
 * basket lives in this browser), then the stored quantities — read through
 * useSyncExternalStore so there's no mount effect and no hydration mismatch.
 */
export function useBasket(slug: string): Record<string, number> | null {
  const raw = useSyncExternalStore(subscribeBasket, () => rawBasket(slug), () => null);
  return useMemo(() => (raw === null ? null : parseBasket(raw)), [raw]);
}

// A Group Buy order handed to the payment gateway. The gateway returns to the
// store's /checkout/success, which must then leave the STORE cart alone.
const PENDING = 'ascend-gb-pending';

export function rememberGroupBuyCheckout(slug: string, orderNumber: string): void {
  try { localStorage.setItem(PENDING, JSON.stringify({ slug, orderNumber, at: Date.now() })); } catch { /* private mode */ }
}

export function readGroupBuyCheckout(): { slug: string; orderNumber: string } | null {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING) || 'null');
    if (!v || Date.now() - v.at > 6 * 3600 * 1000) return null;
    return { slug: v.slug, orderNumber: v.orderNumber };
  } catch {
    return null;
  }
}

export function forgetGroupBuyCheckout(): void {
  try { localStorage.removeItem(PENDING); } catch { /* private mode */ }
}

// Read once per page load and kept: the success page forgets the record as
// soon as it has cleared the basket, but must keep showing the batch wording.
let pendingSnapshot: { slug: string; orderNumber: string } | null | undefined;
const noSubscribe = () => () => {};

/** The Group Buy order this browser just paid for, if any (null on the server). */
export function usePendingGroupBuyCheckout(): { slug: string; orderNumber: string } | null {
  return useSyncExternalStore(noSubscribe, () => {
    if (pendingSnapshot === undefined) pendingSnapshot = readGroupBuyCheckout();
    return pendingSnapshot;
  }, () => null);
}

/** "3d 4h", "5h 12m", "12m" until a time. */
export function countdown(to: string | Date, now = Date.now()): { d: number; h: number; m: number; s: number; done: boolean } {
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return { d: 0, h: 0, m: 0, s: 0, done: true };
  const s = Math.floor(ms / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60, done: false };
}
