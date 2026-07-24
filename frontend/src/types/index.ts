export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  productCount: number;
}

// A single sellable SKU (one size/strength) belonging to a parent Product.
export interface ProductVariant {
  id: string;
  productId: string;
  code: string;
  size: string | null;
  price: number;
  salePrice: number | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  stock: number;
  imageUrl: string | null;
  active: boolean;
  updatedAt: string;
}

// Parent product line (e.g. "Retatrutide") — owns the one storefront URL and
// everything shared across sizes. Sellable SKUs are in `variants`.
export interface Product {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  description: string | null;
  benefits: string | null;
  dosageInfo: string | null;
  coaUrl: string | null;
  featured: boolean;
  sortOrder: number;
  active: boolean;
  // Hides this product from the public catalog/listing and its own product
  // page while keeping it fully eligible to be used as another product's
  // add-on (unlike `active`, which gates both). For supply items meant only
  // to be bundled, never browsed/purchased on their own.
  addOnOnly: boolean;
  updatedAt: string;
  category: {
    name: string;
    slug: string;
  };
  // Plain-text nudge shown near Add to Cart on the storefront (e.g. "Needs
  // Bacteriostatic Water to reconstitute") — informational only, distinct
  // from the required/forced add-on mechanism below.
  addOnReminder?: string | null;
  variants: ProductVariant[];
  // Present on the public product-detail response; absent from list/admin
  // responses that don't include it.
  addOns?: AddOnVariant[];
}

// An add-on as attached to a parent product's page: the specific sellable
// variant being offered, plus its own parent's name/slug/category (for
// display and linking) and the join row's required/quantity for this
// specific parent-add-on pairing.
export interface AddOnVariant {
  id: string;
  code: string;
  size: string | null;
  price: number;
  salePrice: number | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  stock: number;
  imageUrl: string | null;
  active: boolean;
  name: string;
  slug: string;
  category: { name: string; slug: string };
  // Force-selected and locked on the storefront — the customer cannot
  // uncheck it (enforced again server-side at order creation).
  addOnRequired: boolean;
  // Fixed quantity added — does not scale with the purchased variant's quantity.
  addOnQuantity: number;
}

export interface CartItem {
  variantId: string;
  code: string;
  name: string;
  size: string | null;
  price: number;
  quantity: number;
  // Available stock at add-to-cart time — used to clamp merged quantities in
  // the cart reducer. Optional because carts saved before this field existed
  // won't have it (the backend re-validates stock at order creation anyway).
  stock?: number;
  imageUrl: string | null;
}

export interface OrderItem {
  id: string;
  variantId: string;
  quantity: number;
  unitPrice: number;
  variant: {
    code: string;
    size: string | null;
    imageUrl?: string | null;
    product: { name: string };
  };
}

// Per-order transactional email status from the backend outbox (admin only).
export interface OrderEmail {
  type: 'ORDER_CONFIRMATION' | 'PAYMENT_RECEIPT';
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  sentAt: string | null;
  lastError: string | null;
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
  deletedAt: string | null;
  createdAt: string;
  items: OrderItem[];
  // Only present on admin order responses.
  emails?: OrderEmail[];
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

export interface RelatedProductRef {
  id: string;
  name: string;
  slug: string;
}

// Admin-managed "Insights" article — research commentary and product
// updates, credited to a named author.
export interface Insight {
  id: string;
  title: string;
  slug: string;
  category: string;
  excerpt: string;
  content: string;
  coverImageUrl: string | null;
  authorName: string;
  authorRole: string;
  citationTitle: string | null;
  citationSource: string | null;
  citationUrl: string | null;
  readTimeMinutes: number;
  relatedProductIds: string[];
  published: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Present only on the public single-insight response (resolved server-side
  // from relatedProductIds, excluding hidden/discontinued products).
  relatedProducts?: RelatedProductRef[];
}
