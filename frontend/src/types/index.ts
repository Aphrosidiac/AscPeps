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
  // Product-level gallery, already ordered by sortOrder. Returned by the
  // product-detail and admin endpoints; absent from the public list response,
  // which only needs one thumbnail per card.
  images?: ProductImage[];
}

export interface ProductImage {
  id: string;
  url: string;
  sortOrder: number;
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
  // Cents, per unit. null means this line hasn't been priced yet — which the
  // Profit Sharing tab reports as unknown profit, not as a 100% margin.
  // Admin responses only.
  unitCost?: number | null;
  variant: {
    code: string;
    size: string | null;
    imageUrl?: string | null;
    product: { name: string };
  };
}

// Per-order transactional email status from the backend outbox (admin only).
// DELIVERED/BOUNCED/COMPLAINED are set by the Resend webhook
// (modules/webhooks/resend-webhook.controller.ts) once a SENT message
// reaches one of those terminal delivery events.
export interface OrderEmail {
  type: 'ORDER_CONFIRMATION' | 'PAYMENT_RECEIPT';
  status: 'PENDING' | 'SENT' | 'FAILED' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED';
  attempts: number;
  sentAt: string | null;
  lastError: string | null;
}

// A full outbox row on the admin Emails ops page — the per-order OrderEmail
// shape plus identity/scheduling fields and the parent order reference.
export interface AdminEmailRow extends OrderEmail {
  id: string;
  toEmail: string;
  createdAt: string;
  nextAttemptAt: string;
  order: { id: string; orderNumber: string };
}

export interface AdminEmailsResponse extends PaginatedResponse<AdminEmailRow> {
  stats: {
    pending: number;
    failed: number;
    sentLast7Days: number;
  };
  // Whether RESEND_API_KEY is set on the server — distinct from the
  // emails_enabled DB toggle, so the admin UI can tell "off because you
  // turned it off" apart from "off because there's no key to turn on".
  hasApiKey: boolean;
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
  // Full rows on the admin single-order response. List rows carry these too,
  // but populated with `shareBps` only — enough for the progress badge to tell
  // whether a split exists and totals 100%, without shipping every name and
  // amount into a list of 24 orders.
  profitShares?: OrderProfitShare[];
  // Only present on the admin single-order response, not the list.
  extraCosts?: OrderExtraCost[];
}

export interface OrderExtraCost {
  id: string;
  orderId: string;
  label: string;
  // Cents.
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export type OrderExtraCostInput = Pick<OrderExtraCost, 'label' | 'amount'>;

export interface OrderItemCostInput {
  itemId: string;
  unitCost: number | null;
}

export interface OrderProfitShare {
  id: string;
  orderId: string;
  name: string;
  // Basis points — 5000 = 50%. Governs PROFIT only.
  shareBps: number;
  // Cents of this order's COSTS this person paid up front. Owed back to them,
  // so it is ADDED to their profit cut, never subtracted.
  capitalAmount: number;
  createdAt: string;
  updatedAt: string;
}

export type OrderProfitShareInput = Pick<OrderProfitShare, 'name' | 'shareBps' | 'capitalAmount'>;

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
  // Present on the single-insight responses (public + admin), not on lists.
  figures?: InsightFigure[];
}

// A reader's comment on an article. `memberId` is present so the signed-in
// reader's own comments can offer a delete control without a second request;
// it identifies the author to the client only, never an email address.
export interface InsightComment {
  id: string;
  body: string;
  createdAt: string;
  memberId: string;
  member: { displayName: string };
}

// The storefront account. Distinct from the admin user — see the `kind` claim
// note in backend/src/plugins/auth.ts.
export interface Member {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
}

// The moderation-queue view of a comment: carries the hidden flag, the article
// it belongs to, and the author's email/ban state — none of which appear in
// the public InsightComment above.
export interface AdminComment {
  id: string;
  body: string;
  hidden: boolean;
  createdAt: string;
  insight: { id: string; title: string; slug: string };
  member: { id: string; displayName: string; email: string; banned: boolean };
}

export interface InsightFigure {
  id: string;
  insightId: string;
  // 1-based, and it is the printed label the reader sees ("Figure 3").
  order: number;
  imageUrl: string;
  caption: string;
  altText: string;
  credit: string | null;
  creditUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

// What the admin form sends. `order` is omitted on purpose — the server derives
// it from array position, so the printed number can't disagree with the order
// the figures were sent in.
export type InsightFigureInput = Pick<
  InsightFigure,
  'imageUrl' | 'caption' | 'altText' | 'credit' | 'creditUrl'
>;

/* ------------------------------------------------------------------ Finance */

export type FundingType = 'CONTRIBUTION' | 'ADVANCE';

export interface Partner {
  id: string;
  name: string;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerBalance {
  partnerId: string;
  name: string;
  active: boolean;
  earned: number;
  /** Order costs they paid out of pocket. Owed back to them. */
  capitalFronted: number;
  /** Capital they never want back — deliberately absent from `owed`. */
  contributed: number;
  advancesTotal: number;
  advancesRepaid: number;
  advancesOutstanding: number;
  paidOut: number;
  /** earned + capitalFronted + advancesOutstanding − paidOut */
  owed: number;
}

export interface PartnerRef {
  id: string;
  name: string;
}

export interface CompanyExpense {
  id: string;
  occurredAt: string;
  category: string;
  description: string;
  amount: number;
  paidByPartnerId: string | null;
  receiptUrl: string | null;
  paidBy?: PartnerRef | null;
  funding?: { id: string; type: FundingType; repayments: { amount: number }[] } | null;
}

export interface PartnerFunding {
  id: string;
  partnerId: string;
  type: FundingType;
  amount: number;
  occurredAt: string;
  description: string;
  /** Set when this funding is a partner having paid a company expense. */
  expenseId: string | null;
  expense?: { id: string; description: string; category: string } | null;
  repayments: PartnerRepayment[];
}

export interface PartnerRepayment {
  id: string;
  fundingId: string;
  amount: number;
  occurredAt: string;
  note: string | null;
}

export interface ProfitPayout {
  id: string;
  partnerId: string;
  amount: number;
  occurredAt: string;
  note: string | null;
}

export interface PartnerEarning {
  orderId: string;
  orderNumber: string;
  occurredAt: string;
  shareBps: number;
  orderProfit: number;
  amount: number;
  costed: boolean;
}

export interface FinanceOverview {
  grossOrderProfit: number;
  companySpend: number;
  netProfit: number;
  totalContributed: number;
  totalAdvancesOutstanding: number;
  totalPaidOut: number;
  costedOrders: number;
  uncostedOrders: number;
  partners: PartnerBalance[];
  recentActivity: FinanceActivity[];
}

export type FinanceActivityKind =
  | 'EXPENSE'
  | 'CONTRIBUTION'
  | 'ADVANCE'
  | 'REPAYMENT'
  | 'PAYOUT';

/** One entry in the finance feed — every way money moves, not just spending. */
export interface FinanceActivity {
  id: string;
  kind: FinanceActivityKind;
  occurredAt: string;
  description: string;
  partnerId: string | null;
  partnerName: string | null;
  amount: number;
  /** Which way the money moved relative to the company. */
  direction: 'IN' | 'OUT';
  /** EXPENSE only. */
  category?: string;
  /** EXPENSE only — set when a partner fronted it, saying on what terms. */
  fundedAs?: 'CONTRIBUTION' | 'ADVANCE' | null;
}

export interface PartnerDetail {
  partner: Partner;
  balance?: PartnerBalance;
  earnings: PartnerEarning[];
  funding: PartnerFunding[];
  payouts: ProfitPayout[];
}
