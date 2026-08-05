import axios from 'axios';
import type { Category, Product, Order, OrderProfitShare, OrderProfitShareInput, OrderItemCostInput, OrderExtraCostInput, PaginatedResponse, Insight, InsightComment, AdminComment, Member, AdminEmailsResponse, FinanceOverview, PartnerDetail, Partner, CompanyExpense } from '@/types';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? '',
});

// Auto-redirect to admin login on expired/invalid JWT
// Only fires for requests that sent an Authorization header (admin calls).
// Public customer-facing routes never send auth headers, so they're unaffected.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      error.config?.headers?.Authorization &&
      typeof window !== 'undefined'
    ) {
      localStorage.removeItem('ascend-admin-token');
      // Only redirect if we're on an admin page (extra safety for customer pages)
      if (window.location.pathname.startsWith('/admin')) {
        window.location.href = '/admin/login';
      }
    }
    return Promise.reject(error);
  }
);

// Public
export const getCategories = () =>
  api.get<Category[]>('/api/v1/categories').then((r) => r.data);

export const getProducts = (params?: { category?: string; search?: string; page?: number; limit?: number }) =>
  api.get<PaginatedResponse<Product>>('/api/v1/products', { params }).then((r) => r.data);

export const getProduct = (slug: string) =>
  api.get<Product>(`/api/v1/products/${slug}`).then((r) => r.data);

export const createOrder = (data: {
  customerName: string;
  phone: string;
  email?: string;
  address: string;
  city: string;
  state: string;
  postcode: string;
  paymentMethod: 'WHATSAPP' | 'BILLPLZ';
  notes?: string;
  /** Checkout's newsletter tickbox — only honoured when `email` is present. */
  subscribe?: boolean;
  items: { variantId: string; quantity: number }[];
  discountCode?: string;
  idempotencyKey?: string;
}) => api.post<{ order: Order; whatsappUrl?: string; paymentUrl?: string }>('/api/v1/orders', data).then((r) => r.data);

export const lookupOrders = (phone?: string, orderNumber?: string) =>
  api.get<Order[]>('/api/v1/orders/lookup', { params: { ...(phone && { phone }), ...(orderNumber && { orderNumber }) } }).then((r) => r.data);

export const getReceiptData = (orderNumber: string, phone: string) =>
  api.get<Order>(`/api/v1/orders/receipt/${encodeURIComponent(orderNumber)}`, { params: { phone } }).then((r) => r.data);

export const getReceiptPdfUrl = (orderNumber: string, phone: string) =>
  `/api/v1/orders/receipt/${encodeURIComponent(orderNumber)}/pdf?phone=${encodeURIComponent(phone)}`;

// Fetches the receipt PDF with a normal Authorization header and opens it in
// a new tab via a short-lived object URL. Replaces the old ?token= URL, which
// leaked the admin JWT into browser history / server access logs.
export const adminOpenReceiptPdf = (token: string, id: string) =>
  api.get<Blob>(`/api/v1/admin/orders/${id}/receipt`, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: 'blob',
  }).then((r) => {
    const url = URL.createObjectURL(r.data);
    window.open(url, '_blank', 'noopener,noreferrer');
    // Revoke once the new tab has had time to load the blob — revoking
    // synchronously can abort the load in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });

export const getSettings = () =>
  api.get<Record<string, string>>('/api/v1/settings').then((r) => r.data);

// Admin
export const adminLogin = (email: string, password: string) =>
  api.post<{ token: string; user: { id: string; email: string; name: string } }>('/api/v1/auth/login', { email, password }).then((r) => r.data);

export const adminGetMe = (token: string) =>
  api.get('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminGetDashboard = (token: string) =>
  api.get('/api/v1/admin/dashboard/stats', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminGetProducts = (token: string, params?: Record<string, string>) =>
  api.get<PaginatedResponse<Product>>('/api/v1/admin/products', { headers: { Authorization: `Bearer ${token}` }, params }).then((r) => r.data);

export const adminGetProduct = (token: string, id: string) =>
  api.get<Product>(`/api/v1/admin/products/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminCreateProduct = (token: string, data: Record<string, unknown>) =>
  api.post('/api/v1/admin/products', data, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminUpdateProduct = (token: string, id: string, data: Record<string, unknown>) =>
  api.patch(`/api/v1/admin/products/${id}`, data, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminGetOrders = (token: string, params?: Record<string, string>) =>
  api.get<PaginatedResponse<Order>>('/api/v1/admin/orders', { headers: { Authorization: `Bearer ${token}` }, params }).then((r) => r.data);

export const adminGetOrder = (token: string, id: string) =>
  api.get<Order>(`/api/v1/admin/orders/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminUpdateOrder = (token: string, id: string, data: Record<string, unknown>) =>
  api.patch(`/api/v1/admin/orders/${id}`, data, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminUpdateOrderCosts = (
  token: string,
  id: string,
  data: { itemCosts: OrderItemCostInput[]; extraCosts: OrderExtraCostInput[] }
) =>
  api.put<Order>(`/api/v1/admin/orders/${id}/costs`, data, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminUpdateOrderProfitShares = (token: string, id: string, shares: OrderProfitShareInput[]) =>
  api.put<OrderProfitShare[]>(`/api/v1/admin/orders/${id}/profit-shares`, { shares }, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminDeleteOrder = (token: string, id: string) =>
  api.delete(`/api/v1/admin/orders/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminRestoreOrder = (token: string, id: string) =>
  api.post(`/api/v1/admin/orders/${id}/restore`, {}, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminResendOrderEmail = (token: string, id: string, type: 'ORDER_CONFIRMATION' | 'PAYMENT_RECEIPT') =>
  api.post(`/api/v1/admin/orders/${id}/resend-email`, { type }, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminGetEmails = (token: string, params: { status?: string; page?: number; pageSize?: number }) =>
  api.get<AdminEmailsResponse>('/api/v1/admin/emails', { headers: { Authorization: `Bearer ${token}` }, params }).then((r) => r.data);

export const adminRetryFailedEmails = (token: string) =>
  api.post<{ retried: number }>('/api/v1/admin/emails/retry-failed', {}, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminPreviewEmail = (token: string, params: { type: 'ORDER_CONFIRMATION' | 'PAYMENT_RECEIPT'; orderId?: string }) =>
  api.get<{ subject: string; html: string }>('/api/v1/admin/emails/preview', { headers: { Authorization: `Bearer ${token}` }, params }).then((r) => r.data);

// Ad-hoc test send — bypasses the emails_enabled toggle server-side, but
// still requires RESEND_API_KEY to be configured.
export const adminSendTestEmail = (token: string, data: { type: 'ORDER_CONFIRMATION' | 'PAYMENT_RECEIPT'; orderId?: string; to: string }) =>
  api.post<{ id: string }>('/api/v1/admin/emails/test-send', data, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminDeleteProduct = (token: string, id: string) =>
  api.delete(`/api/v1/admin/products/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminGetSettings = (token: string) =>
  api.get<Record<string, string>>('/api/v1/admin/settings', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminUpdateSettings = (token: string, data: Record<string, string>) =>
  api.put<Record<string, string>>('/api/v1/admin/settings', data, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminUploadImage = (token: string, file: File, onProgress?: (percent: number) => void) => {
  const form = new FormData();
  form.append('file', file);
  return api.post<{ url: string; filename: string }>('/api/v1/admin/upload/image', form, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress
      ? (e) => onProgress(e.total ? Math.round((e.loaded / e.total) * 100) : 0)
      : undefined,
  }).then((r) => r.data);
};

// Analytics
export const adminGetAnalytics = (token: string, days?: number) =>
  api.get('/api/v1/admin/dashboard/analytics', { headers: { Authorization: `Bearer ${token}` }, params: { days } }).then((r) => r.data);

// Discounts
export const adminGetDiscounts = (token: string, params?: Record<string, string>) =>
  api.get('/api/v1/admin/discounts', { headers: { Authorization: `Bearer ${token}` }, params }).then((r) => r.data);

export const adminCreateDiscount = (token: string, data: Record<string, unknown>) =>
  api.post('/api/v1/admin/discounts', data, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminUpdateDiscount = (token: string, id: string, data: Record<string, unknown>) =>
  api.patch(`/api/v1/admin/discounts/${id}`, data, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminDeleteDiscount = (token: string, id: string) =>
  api.delete(`/api/v1/admin/discounts/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

// Validate discount (public)
export const validateDiscount = (code: string, subtotal: number) =>
  api.post<{ code: string; discountType: string; discountValue: number; discountAmount: number }>('/api/v1/orders/validate-discount', { code, subtotal }).then((r) => r.data);

// Insights
export const adminGetInsights = (token: string, params?: Record<string, string>) =>
  api.get<PaginatedResponse<Insight>>('/api/v1/admin/insights', { headers: { Authorization: `Bearer ${token}` }, params }).then((r) => r.data);

export const adminGetInsight = (token: string, id: string) =>
  api.get<Insight>(`/api/v1/admin/insights/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminCreateInsight = (token: string, data: Record<string, unknown>) =>
  api.post('/api/v1/admin/insights', data, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminUpdateInsight = (token: string, id: string, data: Record<string, unknown>) =>
  api.patch(`/api/v1/admin/insights/${id}`, data, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminDeleteInsight = (token: string, id: string) =>
  api.delete(`/api/v1/admin/insights/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

/* ------------------------------------------------------------------ Finance */

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

export const adminGetFinanceOverview = (token: string) =>
  api.get<FinanceOverview>('/api/v1/admin/finance/overview', auth(token)).then((r) => r.data);

export const adminGetPartner = (token: string, id: string) =>
  api.get<PartnerDetail>(`/api/v1/admin/finance/partners/${id}`, auth(token)).then((r) => r.data);

export const adminSavePartners = (
  token: string,
  partners: { id?: string; name: string; ownershipBps: number; active: boolean; notes?: string | null }[]
) => api.put<Partner[]>('/api/v1/admin/finance/partners', { partners }, auth(token)).then((r) => r.data);

export const adminGetExpenses = (token: string, params?: Record<string, string>) =>
  api
    .get<{ expenses: CompanyExpense[]; categories: string[] }>('/api/v1/admin/finance/expenses', {
      ...auth(token),
      params,
    })
    .then((r) => r.data);

export const adminCreateExpense = (token: string, data: Record<string, unknown>) =>
  api.post<CompanyExpense>('/api/v1/admin/finance/expenses', data, auth(token)).then((r) => r.data);

export const adminDeleteExpense = (token: string, id: string) =>
  api.delete(`/api/v1/admin/finance/expenses/${id}`, auth(token)).then((r) => r.data);

export const adminCreateFunding = (token: string, data: Record<string, unknown>) =>
  api.post('/api/v1/admin/finance/funding', data, auth(token)).then((r) => r.data);

export const adminDeleteFunding = (token: string, id: string) =>
  api.delete(`/api/v1/admin/finance/funding/${id}`, auth(token)).then((r) => r.data);

export const adminCreateRepayment = (token: string, data: Record<string, unknown>) =>
  api.post('/api/v1/admin/finance/repayments', data, auth(token)).then((r) => r.data);

export const adminDeleteRepayment = (token: string, id: string) =>
  api.delete(`/api/v1/admin/finance/repayments/${id}`, auth(token)).then((r) => r.data);

export const adminCreatePayout = (token: string, data: Record<string, unknown>) =>
  api.post('/api/v1/admin/finance/payouts', data, auth(token)).then((r) => r.data);

export const adminDeletePayout = (token: string, id: string) =>
  api.delete(`/api/v1/admin/finance/payouts/${id}`, auth(token)).then((r) => r.data);

// ---- WhatsApp AI agent ----

export const adminWhatsAppStatus = (token: string) =>
  api.get('/api/v1/admin/whatsapp/status', auth(token)).then((r) => r.data);

export const adminWhatsAppQR = (token: string) =>
  api.get('/api/v1/admin/whatsapp/qr', auth(token)).then((r) => r.data);

export const adminWhatsAppConnect = (token: string) =>
  api.post('/api/v1/admin/whatsapp/connect', {}, auth(token)).then((r) => r.data);

export const adminWhatsAppStop = (token: string) =>
  api.post('/api/v1/admin/whatsapp/stop', {}, auth(token)).then((r) => r.data);

export const adminWhatsAppDisconnect = (token: string) =>
  api.post('/api/v1/admin/whatsapp/disconnect', {}, auth(token)).then((r) => r.data);

export const adminWhatsAppSend = (token: string, phone: string, message: string) =>
  api.post('/api/v1/admin/whatsapp/send', { phone, message }, auth(token)).then((r) => r.data);

export const adminWhatsAppGroups = (token: string) =>
  api.get('/api/v1/admin/whatsapp/groups', auth(token)).then((r) => r.data);

export const adminAgentOperators = (token: string) =>
  api.get('/api/v1/admin/whatsapp/operators', auth(token)).then((r) => r.data);

export const adminAgentSaveOperator = (token: string, data: Record<string, unknown>) =>
  api.post('/api/v1/admin/whatsapp/operators', data, auth(token)).then((r) => r.data);

export const adminAgentDeleteOperator = (token: string, id: string) =>
  api.delete(`/api/v1/admin/whatsapp/operators/${id}`, auth(token)).then((r) => r.data);

export const adminAgentSaveGroup = (token: string, data: Record<string, unknown>) =>
  api.post('/api/v1/admin/whatsapp/groups', data, auth(token)).then((r) => r.data);

export const adminAgentConversations = (token: string) =>
  api.get('/api/v1/admin/whatsapp/conversations', auth(token)).then((r) => r.data);

export const adminAgentConversation = (token: string, id: string) =>
  api.get(`/api/v1/admin/whatsapp/conversations/${id}`, auth(token)).then((r) => r.data);

export const adminAgentToolCalls = (token: string, params?: Record<string, string>) =>
  api.get('/api/v1/admin/whatsapp/tool-calls', { ...auth(token), params }).then((r) => r.data);

export const adminAgentUnknownSenders = (token: string) =>
  api.get('/api/v1/admin/whatsapp/unknown-senders', auth(token)).then((r) => r.data);

export const adminAgentBindSender = (token: string, identifier: string, operatorId: string) =>
  api.post('/api/v1/admin/whatsapp/unknown-senders/bind', { identifier, operatorId }, auth(token)).then((r) => r.data);

export const adminAgentDismissSender = (token: string, identifier: string) =>
  api
    .delete(`/api/v1/admin/whatsapp/unknown-senders/${encodeURIComponent(identifier)}`, auth(token))
    .then((r) => r.data);

// ---- Delivery scheduling ----







export const adminDeliveryBookings = (token: string, params?: Record<string, string>) =>
  api.get('/api/v1/admin/delivery/bookings', { ...auth(token), params }).then((r) => r.data);

export const adminScheduleDelivery = (token: string, data: Record<string, unknown>) =>
  api.post('/api/v1/admin/delivery/bookings', data, auth(token)).then((r) => r.data);

export const adminUpdateDeliveryStatus = (token: string, id: string, data: Record<string, unknown>) =>
  api.patch(`/api/v1/admin/delivery/bookings/${id}`, data, auth(token)).then((r) => r.data);

export const adminCancelDelivery = (token: string, id: string) =>
  api.delete(`/api/v1/admin/delivery/bookings/${id}`, auth(token)).then((r) => r.data);

export const adminUnscheduledOrders = (token: string) =>
  api.get('/api/v1/admin/delivery/unscheduled', auth(token)).then((r) => r.data);

// --- Newsletter (public) ---------------------------------------------------

// `website` is the honeypot. Always sent, always empty from a real form —
// the server drops the submission when it isn't.
export const subscribeToNewsletter = (data: { email: string; source: 'FOOTER' | 'CHECKOUT'; website?: string }) =>
  api.post<{ ok: true }>('/api/v1/subscribers', data).then((r) => r.data);

export const unsubscribeNewsletter = (token: string) =>
  api.get<{ ok: true; email?: string }>('/api/v1/subscribers/unsubscribe', { params: { token } }).then((r) => r.data);

// --- Newsletter (admin) ----------------------------------------------------

export const adminGetSubscribers = (token: string, params?: Record<string, string>) =>
  api.get('/api/v1/admin/subscribers', { ...auth(token), params }).then((r) => r.data);

export const adminSubscriberStats = (token: string) =>
  api.get('/api/v1/admin/subscribers/stats', auth(token)).then((r) => r.data);

export const adminAddSubscriber = (token: string, email: string) =>
  api.post('/api/v1/admin/subscribers', { email }, auth(token)).then((r) => r.data);

export const adminUnsubscribeSubscriber = (token: string, id: string) =>
  api.post(`/api/v1/admin/subscribers/${id}/unsubscribe`, {}, auth(token)).then((r) => r.data);

export const adminRetryWelcomeEmail = (token: string, id: string) =>
  api.post(`/api/v1/admin/subscribers/${id}/retry-welcome`, {}, auth(token)).then((r) => r.data);

export const adminDeleteSubscriber = (token: string, id: string) =>
  api.delete(`/api/v1/admin/subscribers/${id}`, auth(token)).then((r) => r.data);

// Fetched with the auth header and saved via an object URL, same pattern as
// adminOpenReceiptPdf — a `?token=` download link would leak the admin JWT
// into browser history and the server access log.
export const adminExportSubscribers = (token: string, params?: Record<string, string>) =>
  api.get<Blob>('/api/v1/admin/subscribers/export', { ...auth(token), params, responseType: 'blob' }).then((r) => {
    const url = URL.createObjectURL(r.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ascend-subscribers.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });

export const adminGetCampaigns = (token: string, params?: Record<string, string>) =>
  api.get('/api/v1/admin/campaigns', { ...auth(token), params }).then((r) => r.data);

export const adminGetCampaign = (token: string, id: string) =>
  api.get(`/api/v1/admin/campaigns/${id}`, auth(token)).then((r) => r.data);

export const adminAudienceCount = (token: string, audience: string) =>
  api.get<{ audience: string; count: number }>('/api/v1/admin/campaigns/audience-count', {
    ...auth(token),
    params: { audience },
  }).then((r) => r.data);

export const adminCreateCampaign = (token: string, data: Record<string, unknown>) =>
  api.post('/api/v1/admin/campaigns', data, auth(token)).then((r) => r.data);

export const adminUpdateCampaign = (token: string, id: string, data: Record<string, unknown>) =>
  api.patch(`/api/v1/admin/campaigns/${id}`, data, auth(token)).then((r) => r.data);

export const adminDeleteCampaign = (token: string, id: string) =>
  api.delete(`/api/v1/admin/campaigns/${id}`, auth(token)).then((r) => r.data);

export const adminSendTestCampaign = (token: string, id: string, email: string) =>
  api.post(`/api/v1/admin/campaigns/${id}/test`, { email }, auth(token)).then((r) => r.data);

export const adminSendCampaign = (token: string, id: string) =>
  api.post<{ ok: true; recipientCount: number }>(`/api/v1/admin/campaigns/${id}/send`, {}, auth(token)).then((r) => r.data);

// ---- Member accounts & Insight comments ----
//
// Member calls pass their token explicitly, the same convention the admin
// calls above use. Note the axios 401 interceptor at the top of this file
// only redirects when the request is on an /admin path, so an expired member
// token surfaces as a normal error for the component to handle rather than
// yanking a reader off the article they were reading.

export const memberRegister = (data: { email: string; password: string; displayName: string }) =>
  api.post<{ success: boolean; message: string }>('/api/v1/members/register', data).then((r) => r.data);

export const memberLogin = (data: { email: string; password: string }) =>
  api.post<{ token: string; member: Member }>('/api/v1/members/login', data).then((r) => r.data);

export const memberMe = (token: string) =>
  api.get<Member>('/api/v1/members/me', auth(token)).then((r) => r.data);

export const memberVerifyEmail = (token: string) =>
  api
    .get<{ success: boolean }>('/api/v1/members/verify', { params: { token } })
    .then((r) => r.data);

export const memberResendVerification = (email: string) =>
  api
    .post<{ success: boolean; message: string }>('/api/v1/members/resend-verification', { email })
    .then((r) => r.data);

export const getInsightComments = (slug: string) =>
  api.get<{ data: InsightComment[] }>(`/api/v1/insights/${encodeURIComponent(slug)}/comments`).then((r) => r.data);

export const postInsightComment = (token: string, slug: string, body: string) =>
  api
    .post<InsightComment>(`/api/v1/insights/${encodeURIComponent(slug)}/comments`, { body }, auth(token))
    .then((r) => r.data);

export const deleteInsightComment = (token: string, id: string) =>
  api.delete(`/api/v1/insights/comments/${id}`, auth(token)).then((r) => r.data);

// ---- Admin comment moderation ----

export const adminListComments = (token: string, params?: Record<string, string>) =>
  api.get<PaginatedResponse<AdminComment>>('/api/v1/admin/comments', { ...auth(token), params }).then((r) => r.data);

export const adminSetCommentHidden = (token: string, id: string, hidden: boolean) =>
  api.patch(`/api/v1/admin/comments/${id}`, { hidden }, auth(token)).then((r) => r.data);

export const adminDeleteComment = (token: string, id: string) =>
  api.delete(`/api/v1/admin/comments/${id}`, auth(token)).then((r) => r.data);

export const adminSetMemberBanned = (token: string, memberId: string, banned: boolean) =>
  api.patch(`/api/v1/admin/comments/members/${memberId}`, { banned }, auth(token)).then((r) => r.data);
