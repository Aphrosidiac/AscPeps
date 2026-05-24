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
  description: string | null;
  benefits: string | null;
  dosageInfo: string | null;
  stock: number;
  imageUrl: string | null;
  active: boolean;
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
  total: number;
  status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  paymentMethod: 'WHATSAPP' | 'BILLPLZ';
  paymentStatus: 'UNPAID' | 'PAID' | 'FAILED' | 'REFUNDED';
  notes: string | null;
  createdAt: string;
  items: OrderItem[];
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
