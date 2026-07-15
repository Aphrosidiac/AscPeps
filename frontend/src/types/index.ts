export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  productCount: number;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  slug: string;
  categoryId: string;
  size: string | null;
  price: number;
  salePrice: number | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  description: string | null;
  benefits: string | null;
  dosageInfo: string | null;
  stock: number;
  imageUrl: string | null;
  coaUrl: string | null;
  featured: boolean;
  active: boolean;
  updatedAt: string;
  category: {
    name: string;
    slug: string;
  };
}

export interface CartItem {
  productId: string;
  code: string;
  name: string;
  size: string | null;
  price: number;
  quantity: number;
  imageUrl: string | null;
}

export interface OrderItem {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  product: {
    name: string;
    code: string;
    imageUrl?: string | null;
  };
}

export interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  email: string | null;
  address: string;
  city: string;
  state: string;
  postcode: string;
  subtotal: number;
  shippingFee: number;
  discountAmount: number;
  total: number;
  status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  paymentMethod: 'WHATSAPP' | 'BILLPLZ';
  paymentGateway: string | null;
  paymentStatus: 'UNPAID' | 'PAID' | 'FAILED' | 'REFUNDED';
  discountCodeId: string | null;
  discountCode?: { code: string; discountType: string; discountValue: number } | null;
  notes: string | null;
  trackingNumber: string | null;
  createdAt: string;
  items: OrderItem[];
}

export interface DiscountCode {
  id: string;
  code: string;
  description: string | null;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: number;
  minOrderAmount: number | null;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
