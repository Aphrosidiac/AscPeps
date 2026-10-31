import { http } from './api';
import { getMemberToken } from './member-session';
import type { GroupBuyDetail, GroupBuyPromo, GroupBuyStage, GroupBuySummary, Order } from '@/types';

/** Group Buy calls — public, member and admin. Shapes mirror backend/src/modules/*group-buys*. */

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const memberAuth = () => {
  const t = typeof window !== 'undefined' ? getMemberToken() : null;
  return t ? auth(t) : {};
};

// ─── Public ─────────────────────────────────────────────────────────────────

export const getGroupBuys = () => http.get<GroupBuySummary[]>('/api/v1/group-buys').then((r) => r.data);
export const getGroupBuy = (slug: string, adminToken?: string) =>
  http.get<GroupBuyDetail>(`/api/v1/group-buys/${encodeURIComponent(slug)}`, adminToken ? auth(adminToken) : undefined).then((r) => r.data);
export const getGroupBuyPromo = () => http.get<GroupBuyPromo>('/api/v1/group-buys/promo').then((r) => r.data);

export interface SignupResult {
  status: 'joined' | 'already';
  reward: { emailed: boolean; code: string | null; type: string; value: number; expiresAt: string | null } | null;
  rewardNeedsMember: boolean;
}

export const signupGroupBuy = (slug: string, data: { email: string; name?: string; phone?: string; source: 'PAGE' | 'POPUP' | 'HOME' }) =>
  http.post<SignupResult>(`/api/v1/group-buys/${encodeURIComponent(slug)}/signup`, data, memberAuth()).then((r) => r.data);

export interface MySignup {
  id: string;
  createdAt: string;
  source: string;
  groupBuy: { id: string; number: number; label: string; slug: string; title: string; opensAt: string; closesAt: string; phase: string; stageKey: string; stageLabel: string | null };
  reward: { code: string; type: string; value: number; used: boolean; expiresAt: string | null; active: boolean; minOrder: number | null } | null;
}

export interface MyOrder extends Pick<Order, 'id' | 'orderNumber' | 'status' | 'paymentStatus' | 'paymentMethod' | 'createdAt' | 'subtotal' | 'shippingFee' | 'discountAmount' | 'refundedAmount' | 'total' | 'items'> {
  paidAt: string | null;
  confirmedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  isPreorder: boolean;
  phone: string;
  tracking: { number: string; courier: string | null; url: string | null } | null;
  groupBuy: { id: string; number: number; label: string; slug: string; title: string; shipEstimate: string | null; stages: GroupBuyStage[]; stageKey: string; closesAt: string } | null;
}

export const getMyGroupBuys = () =>
  http.get<{ verified: boolean; orders: MyOrder[]; signups: MySignup[] }>('/api/v1/group-buys/mine', memberAuth()).then((r) => r.data);

// ─── Admin ──────────────────────────────────────────────────────────────────

export interface AdminGroupBuyRow {
  id: string; number: number; label: string; slug: string; title: string; published: boolean;
  phase: 'DRAFT' | 'UPCOMING' | 'LIVE' | 'CLOSED'; opensAt: string; closesAt: string; stageKey: string; stageLabel: string;
  itemCount: number; promo: { banner: boolean; popup: boolean; home: boolean; reward: boolean };
  orders: number; paidOrders: number; unpaidOrders: number; revenue: number; signups: number; buyers: number;
}

export interface AdminGroupBuyItem {
  id?: string;
  variantId: string;
  sortOrder?: number;
  sellUnit: 'VIAL' | 'KIT';
  packSize: number;
  unitLabel: string | null;
  minQty: number | null;
  maxQty: number | null;
  minAmount: number | null;
  note: string | null;
  active: boolean;
  tiers: { minQty: number; price: number }[];
  variant?: { name: string; code: string; size: string | null; imageUrl: string | null; active: boolean; storePrice: number };
}

export interface AdminGroupBuy {
  id: string; number: number; label: string; slug: string; title: string; tagline: string | null; description: string | null;
  heroImageUrl: string | null; published: boolean; phase: AdminGroupBuyRow['phase']; opensAt: string; closesAt: string; shipEstimate: string | null;
  minOrderAmount: number | null; maxUnitsPerOrder: number; shippingFee: number | null; allowWhatsapp: boolean;
  joinedMode: 'OFF' | 'REAL' | 'BOOST' | 'FIXED'; joinedBoost: number; joinedFixed: number; joinedLabel: string; joinedShown: number | null;
  bannerEnabled: boolean; bannerText: string | null; bannerCta: string | null; bannerStartsAt: string | null; bannerEndsAt: string | null; bannerTone: 'INK' | 'GREEN' | 'COBALT';
  popupEnabled: boolean; popupTitle: string | null; popupBody: string | null; popupImageUrl: string | null; popupCta: string | null;
  popupStartsAt: string | null; popupEndsAt: string | null; popupDelaySec: number; popupFrequency: 'ONCE' | 'DAILY' | 'SESSION' | 'EVERY'; popupPages: 'ALL' | 'HOME' | 'PRODUCTS';
  homeEnabled: boolean; homeTitle: string | null; homeBody: string | null; homeImageUrl: string | null; homeCta: string | null;
  rewardEnabled: boolean; rewardType: 'PERCENTAGE' | 'FIXED_AMOUNT'; rewardValue: number; rewardScope: 'GROUP_BUY' | 'STORE' | 'ANY';
  rewardMinOrder: number | null; rewardValidDays: number | null; rewardMembersOnly: boolean; rewardHeadline: string | null;
  stages: GroupBuyStage[]; stageKey: string; notifyStageEmails: boolean;
  stats: { orders: number; paidOrders: number; unpaidOrders: number; revenue: number; signups: number; buyers: number };
  items: AdminGroupBuyItem[];
  updatedAt: string;
}

export interface AdminVariantOption { id: string; name: string; code: string; size: string | null; imageUrl: string | null; stock: number; storePrice: number }

export interface AdminSignupRow {
  id: string; email: string; name: string | null; phone: string | null; source: string; note: string | null; createdAt: string;
  member: { id: string; displayName: string; emailVerified: boolean } | null;
  reward: { code: string; used: boolean; active: boolean; expiresAt: string | null; label: string } | null;
  orders: { id: string; orderNumber: string; paymentStatus: string; total: number }[];
  paidTotal: number;
}

export interface AdminGbOrderRow {
  id: string; orderNumber: string; customerName: string; email: string | null; phone: string; status: string; paymentStatus: string;
  total: number; discountAmount: number; createdAt: string; trackingNumber: string | null; discountCode: { code: string } | null; summary: string; vials: number;
}

export interface SupplierSheetRow { variantId: string; name: string; code: string; stock: number; paidVials: number; unpaidVials: number; packSize: number | null }

export interface NoticeRow { id: string; kind: string; stageKey: string | null; toEmail: string; status: string; attempts: number; lastError: string | null; sentAt: string | null; createdAt: string }

const base = '/api/v1/admin/group-buys';
export const adminListGroupBuys = (t: string) => http.get<AdminGroupBuyRow[]>(base, auth(t)).then((r) => r.data);
export const adminCreateGroupBuy = (t: string, title?: string) => http.post<{ id: string }>(base, { title }, auth(t)).then((r) => r.data);
export const adminGetGroupBuy = (t: string, id: string) => http.get<AdminGroupBuy>(`${base}/${id}`, auth(t)).then((r) => r.data);
export const adminUpdateGroupBuy = (t: string, id: string, data: Partial<AdminGroupBuy>) => http.patch<AdminGroupBuy>(`${base}/${id}`, data, auth(t)).then((r) => r.data);
export const adminSetGroupBuyItems = (t: string, id: string, items: AdminGroupBuyItem[]) => http.put<AdminGroupBuy>(`${base}/${id}/items`, { items }, auth(t)).then((r) => r.data);
export const adminSetGroupBuyStages = (t: string, id: string, data: { stages: GroupBuyStage[]; stageKey: string; notify?: boolean }) =>
  http.put<AdminGroupBuy & { queued: number }>(`${base}/${id}/stages`, data, auth(t)).then((r) => r.data);
export const adminNotifyGroupBuyStage = (t: string, id: string) => http.post<{ queued: number }>(`${base}/${id}/notify`, {}, auth(t)).then((r) => r.data);
export const adminDuplicateGroupBuy = (t: string, id: string) => http.post<AdminGroupBuy>(`${base}/${id}/duplicate`, {}, auth(t)).then((r) => r.data);
export const adminDeleteGroupBuy = (t: string, id: string) => http.delete(`${base}/${id}`, auth(t)).then((r) => r.data);
export const adminGroupBuyOrders = (t: string, id: string) => http.get<AdminGbOrderRow[]>(`${base}/${id}/orders`, auth(t)).then((r) => r.data);
export const adminGroupBuySupplierSheet = (t: string, id: string) => http.get<SupplierSheetRow[]>(`${base}/${id}/supplier-sheet`, auth(t)).then((r) => r.data);
export const adminGroupBuySignups = (t: string, id: string) => http.get<AdminSignupRow[]>(`${base}/${id}/signups`, auth(t)).then((r) => r.data);
export const adminAddGroupBuySignup = (t: string, id: string, data: { email: string; name?: string; phone?: string; note?: string }) =>
  http.post(`${base}/${id}/signups`, data, auth(t)).then((r) => r.data);
export const adminUpdateGroupBuySignup = (t: string, id: string, signupId: string, note: string | null) =>
  http.patch(`${base}/${id}/signups/${signupId}`, { note }, auth(t)).then((r) => r.data);
export const adminDeleteGroupBuySignup = (t: string, id: string, signupId: string) => http.delete(`${base}/${id}/signups/${signupId}`, auth(t)).then((r) => r.data);
export const adminGroupBuyNotices = (t: string, id: string) => http.get<NoticeRow[]>(`${base}/${id}/notices`, auth(t)).then((r) => r.data);
export const adminPreviewGroupBuyEmail = (t: string, id: string, kind: 'SIGNUP' | 'STAGE', stageKey?: string) =>
  http.get<{ subject: string; html: string }>(`${base}/${id}/preview-email`, { ...auth(t), params: { kind, stageKey } }).then((r) => r.data);
export const adminGroupBuyVariants = (t: string) => http.get<AdminVariantOption[]>(`${base}/variants`, auth(t)).then((r) => r.data);
export const adminDownloadSignupsCsv = (t: string, id: string) =>
  http.get<Blob>(`${base}/${id}/signups.csv`, { ...auth(t), responseType: 'blob' }).then((r) => r.data);

/** The API's `{ error }` message, or a fallback. */
export function errorText(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  const e = err as { response?: { data?: { error?: string; message?: string } } };
  return e?.response?.data?.error || e?.response?.data?.message || fallback;
}
