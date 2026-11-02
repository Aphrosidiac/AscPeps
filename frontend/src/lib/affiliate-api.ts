import { http } from './api';
import { getMemberToken } from './member-session';

/**
 * Ascend Affiliate calls — the affiliate's own (affiliate.ascendpeptides.my)
 * and Admin → Affiliates. Shapes mirror backend/src/modules/affiliates.
 * Money is integer sen throughout.
 */

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const memberAuth = () => {
  const t = typeof window !== 'undefined' ? getMemberToken() : null;
  return t ? auth(t) : {};
};

export type AffiliateStatus = 'APPLIED' | 'ACTIVE' | 'PAUSED' | 'REJECTED';
export type PayoutStatus = 'REQUESTED' | 'PAID' | 'CANCELLED';
export type OrderState = 'AWAITING_PAYMENT' | 'EARNED' | 'PART_REFUNDED' | 'REFUNDED' | 'CANCELLED' | 'NOT_PAID';
export type EntryKind = 'COMMISSION' | 'REVERSAL' | 'PAYOUT' | 'ADJUSTMENT';

export interface Programme {
  enabled: boolean;
  customerDiscountPct: number;
  commission: string;
  commissionBps: number;
  holdDays: number;
}

export interface Affiliate {
  id: string;
  status: AffiliateStatus;
  rateBps: number;
  commission: string;
  code: string;
  customerDiscountPct: number;
  fullName: string;
  phone: string;
  channel: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface Balance {
  balance: number;
  requested: number;
  available: number;
  earned: number;
  reversed: number;
  paidOut: number;
  awaitingPayment: number;
  awaitingPaymentOrders: number;
}

export interface OpenPayout {
  id: string;
  amount: number;
  availableAt: string;
  createdAt: string;
}

export interface MyAffiliate {
  programme: Programme;
  affiliate: Affiliate | null;
  balance: Balance | null;
  openPayout: OpenPayout | null;
  paidOrdersThisMonth?: number;
}

export interface AffiliateOrder {
  id: string;
  orderNumber: string;
  placedAt: string;
  paidAt: string | null;
  goods: number;
  rate: string;
  commission: number;
  state: OrderState;
}

export interface Entry {
  id: string;
  kind: EntryKind;
  amount: number;
  note: string | null;
  at: string;
  orderNumber: string | null;
}

export interface Payout {
  id: string;
  status: PayoutStatus;
  amount: number;
  paidAmount: number | null;
  availableAt: string;
  createdAt: string;
  paidAt: string | null;
  reference: string | null;
  cancelReason: string | null;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  paidBy?: string | null;
}

// ─── Public / affiliate ─────────────────────────────────────────────────────

export const getProgramme = () => http.get<Programme>('/api/v1/affiliate/programme').then((r) => r.data);
export const getMyAffiliate = () => http.get<MyAffiliate>('/api/v1/affiliate/me', memberAuth()).then((r) => r.data);
export const checkAffiliateCode = (code: string) =>
  http.get<{ code: string; available: boolean; reason: string | null }>('/api/v1/affiliate/code', { ...memberAuth(), params: { code } }).then((r) => r.data);
export const suggestAffiliateCode = (name: string) =>
  http.get<{ code: string }>('/api/v1/affiliate/code', { ...memberAuth(), params: { name } }).then((r) => r.data);
export const joinAffiliate = (data: { fullName: string; phone: string; channel?: string; code: string; acceptTerms: true }) =>
  http.post<{ affiliate: Affiliate }>('/api/v1/affiliate/join', data, memberAuth()).then((r) => r.data);
export const updateMyAffiliate = (data: Partial<Pick<Affiliate, 'fullName' | 'phone' | 'channel' | 'bankName' | 'bankAccountName' | 'bankAccountNumber' | 'code'>>) =>
  http.patch<MyAffiliate>('/api/v1/affiliate/me', data, memberAuth()).then((r) => r.data);
export const getMyAffiliateOrders = (page = 1) =>
  http.get<{ data: AffiliateOrder[]; pagination: { page: number; totalPages: number; total: number } }>('/api/v1/affiliate/orders', { ...memberAuth(), params: { page, limit: 20 } }).then((r) => r.data);
export const getMyEntries = () => http.get<{ entries: Entry[] }>('/api/v1/affiliate/entries', memberAuth()).then((r) => r.data);
export const getMyPayouts = () => http.get<{ payouts: Payout[] }>('/api/v1/affiliate/payouts', memberAuth()).then((r) => r.data);
export const requestMyPayout = () => http.post<{ payout: Payout }>('/api/v1/affiliate/payouts', {}, memberAuth()).then((r) => r.data);

// ─── Admin ──────────────────────────────────────────────────────────────────

export interface AdminAffiliateRow extends Affiliate {
  email: string;
  balance: number;
  earned: number;
  paidOut: number;
  requested: number;
  paidOrders: number;
  sales: number;
}

export interface AdminAffiliateDetail {
  affiliate: Affiliate & { email: string; emailVerified: boolean; adminNote: string | null; approvedBy: string | null };
  balance: Balance;
  orders: AffiliateOrder[];
  entries: Entry[];
  payouts: Payout[];
}

export interface AdminPayoutRow extends Payout {
  affiliateId: string;
  name: string;
  phone: string;
  code: string;
  ready: boolean;
  payableNow: number | null;
}

export interface AffiliateSettings {
  enabled: boolean;
  defaultRateBps: number;
  customerDiscountPct: number;
  marginBudgetPct: number;
  holdDays: number;
  signupBonusEnabled: boolean;
  signupBonusPct: number;
}

const A = '/api/v1/admin/affiliates';
export const adminListAffiliates = (token: string, params: { status?: string; search?: string } = {}) =>
  http.get<{ counts: Partial<Record<AffiliateStatus, number>>; affiliates: AdminAffiliateRow[] }>(A, { ...auth(token), params }).then((r) => r.data);
export const adminGetAffiliate = (token: string, id: string) => http.get<AdminAffiliateDetail>(`${A}/${id}`, auth(token)).then((r) => r.data);
export const adminUpdateAffiliate = (token: string, id: string, data: Record<string, unknown>) =>
  http.patch<AdminAffiliateDetail>(`${A}/${id}`, data, auth(token)).then((r) => r.data);
export const adminAdjustAffiliate = (token: string, id: string, data: { amount: number; note: string }) =>
  http.post<AdminAffiliateDetail>(`${A}/${id}/adjust`, data, auth(token)).then((r) => r.data);
export const adminListAffiliatePayouts = (token: string, status: PayoutStatus = 'REQUESTED') =>
  http.get<{ payouts: AdminPayoutRow[] }>(`${A}/payouts`, { ...auth(token), params: { status } }).then((r) => r.data);
export const adminMarkAffiliatePayoutPaid = (token: string, id: string, data: { reference?: string | null; paidAt?: string }) =>
  http.post<{ status: 'PAID' | 'CANCELLED'; paidAmount: number; note: string | null }>(`${A}/payouts/${id}/paid`, data, auth(token)).then((r) => r.data);
export const adminCancelAffiliatePayout = (token: string, id: string, reason: string) =>
  http.post(`${A}/payouts/${id}/cancel`, { reason }, auth(token)).then((r) => r.data);
export const adminGetAffiliateSettings = (token: string) => http.get<AffiliateSettings>(`${A}/settings`, auth(token)).then((r) => r.data);
export const adminSaveAffiliateSettings = (token: string, data: Partial<AffiliateSettings>) =>
  http.put<AffiliateSettings>(`${A}/settings`, data, auth(token)).then((r) => r.data);

// ─── Shared wording ─────────────────────────────────────────────────────────

export const STATE_LABEL: Record<OrderState, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  EARNED: 'Earned',
  PART_REFUNDED: 'Part refunded',
  REFUNDED: 'Refunded',
  CANCELLED: 'Cancelled',
  NOT_PAID: 'Not paid',
};

export const STATUS_LABEL: Record<AffiliateStatus, string> = {
  APPLIED: 'Waiting for approval',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  REJECTED: 'Not approved',
};

export const ENTRY_LABEL: Record<EntryKind, string> = {
  COMMISSION: 'Commission',
  REVERSAL: 'Taken back',
  PAYOUT: 'Paid to you',
  ADJUSTMENT: 'Adjustment',
};

/** The axios error's message, or a fallback. */
export function apiError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as { response?: { data?: { error?: string; message?: string } } };
  return e?.response?.data?.error || e?.response?.data?.message || fallback;
}
