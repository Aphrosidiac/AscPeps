import axios from 'axios';
import type { Category, Product, Order, PaginatedResponse } from '@/types';

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

export const adminGetReceiptPdfUrl = (id: string, token: string) =>
  `/api/v1/admin/orders/${id}/receipt?token=${encodeURIComponent(token)}`;

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

export const adminUpdateOrder = (token: string, id: string, data: Record<string, unknown>) =>
  api.patch(`/api/v1/admin/orders/${id}`, data, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminDeleteProduct = (token: string, id: string) =>
  api.delete(`/api/v1/admin/products/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminGetSettings = (token: string) =>
  api.get<Record<string, string>>('/api/v1/admin/settings', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminUpdateSettings = (token: string, data: Record<string, string>) =>
  api.put<Record<string, string>>('/api/v1/admin/settings', data, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminUploadImage = (token: string, file: File) => {
  const form = new FormData();
  form.append('file', file);
  return api.post<{ url: string; filename: string }>('/api/v1/admin/upload/image', form, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' },
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
