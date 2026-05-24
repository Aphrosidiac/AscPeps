import axios from 'axios';
import type { Category, Product, Order, PaginatedResponse } from '@/types';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3105',
});

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
  items: { productId: string; quantity: number }[];
}) => api.post<{ order: Order; whatsappUrl?: string }>('/api/v1/orders', data).then((r) => r.data);

export const lookupOrders = (phone: string) =>
  api.get<Order[]>('/api/v1/orders/lookup', { params: { phone } }).then((r) => r.data);

// Admin
export const adminLogin = (email: string, password: string) =>
  api.post<{ token: string; user: { id: string; email: string; name: string } }>('/api/v1/auth/login', { email, password }).then((r) => r.data);

export const adminGetMe = (token: string) =>
  api.get('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminGetDashboard = (token: string) =>
  api.get('/api/v1/admin/dashboard/stats', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data);

export const adminGetProducts = (token: string, params?: Record<string, string>) =>
  api.get<PaginatedResponse<Product>>('/api/v1/admin/products', { headers: { Authorization: `Bearer ${token}` }, params }).then((r) => r.data);

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
