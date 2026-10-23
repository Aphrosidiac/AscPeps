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
  // Never charged shipping when it is the only kind of thing in the cart.
  noShipping?: boolean;
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
  // Per unit of the product it comes with (INCLUDED add-ons scale with that
  // product's quantity); for a SUGGESTED add-on, how many are added.
  addOnQuantity: number;
  // True when the add-on's product is addOnOnly — a syringe, swab or vial that
  // is INCLUDED under the product in the cart and order rather than being a
  // line of its own. False for a SUGGESTED product (MOTS-C on Retatrutide).
  addOnIncluded: boolean;
}

// Something that comes INCLUDED with a cart line (a syringe, swab, vial) — no
// quantity of its own: `perUnit` × the line's quantity.
export interface CartInclude {
  variantId: string;
  code: string;
  name: string;
  perUnit: number;
  price: number;
  required: boolean;
  stock?: number;
}

export interface CartItem {
  // Identity of the line: the product size plus what it includes. Missing on
  // carts saved before bundles (then the variantId stands in).
  lineId?: string;
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
  // The product's noShipping flag. Missing on carts saved before it existed,
  // which correctly means "charge shipping".
  noShipping?: boolean;
  // What comes included with each unit of this line.
  includes?: CartInclude[];
}

export interface OrderItem {
  id: string;
  variantId: string;
  // Set when this item came included with another line (a syringe, swab or
  // vial bundled under a product). See lib/order-lines.ts.
  parentItemId?: string | null;
  quantity: number;
  unitPrice: number;
  // Cents, per unit. null means this line hasn't been priced yet — which the
  // Profit Sharing tab reports as unknown profit, not as a 100% margin.
  // Admin responses only.
  unitCost?: number | null;
  // Whose price list the unit cost was picked from; null when keyed in by
  // hand. Admin responses only.
  supplierId?: string | null;
  supplier?: { id: string; name: string; active: boolean } | null;
  variant: {
    code: string;
    size: string | null;
    imageUrl?: string | null;
    product: { name: string; addOnOnly?: boolean };
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
  /** Manually ticked once the profit for this order has actually been paid out. */
  profitShared?: boolean;
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
  /** Why a hand-keyed discount was given ("bulk order", "15% off"). Null on
   *  code discounts and on orders with none. */
  discountNote: string | null;
  total: number;
  status: 'PENDING' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  paymentMethod: 'WHATSAPP' | 'BILLPLZ' | 'CRYPTO';
  paymentGateway: string | null;
  /** Gateway bill id — or, for the hosted manual checkout, the ManualPayGate session id. */
  paymentRef?: string | null;
  paymentStatus: 'UNPAID' | 'PAID' | 'FAILED' | 'REFUNDED';
  /**
   * What the payment processor kept out of `total`, in cents. A real cost of
   * the sale, deducted alongside item and extra costs. Zero is a real value —
   * WhatsApp/manual transfers and BTCPay genuinely cost nothing to collect.
   */
  gatewayFee: number;
  /** Cents handed back to the customer. Reverses revenue by exactly this much. */
  refundedAmount: number;
  /** Whether the order's stock went back into inventory. Only consulted on a
   *  refunded order — goods that came back are not a cost. */
  stockRestored?: boolean;
  // Why a FAILED order failed. Null on orders that failed before this was
  // recorded, and on every order that didn't fail. See lib/payment-failure.ts.
  paymentFailureReason: PaymentFailureReason | null;
  /** The channel the customer actually tried, e.g. "FPX B2C" / "DuitNow QR". */
  paymentFailureChannel: string | null;
  /** Placed by the team to test checkout; left out of Admin → Payments. */
  isTest?: boolean;
  // The payment trail, on the admin single-order response only.
  paymentAttempts?: PaymentAttempt[];
  paymentEvents?: PaymentEvent[];
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
  /** The share-out that settled this order's profit; legacy = shared by hand. */
  payoutRun?: { id: string; occurredAt: string; legacy: boolean } | null;
  /** The default split rule for this order (in effect when it was paid, or now). */
  defaultSplit?: SplitRuleShare[];
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
  // Omitted leaves the stored supplier alone; null means keyed in by hand.
  supplierId?: string | null;
}

export interface OrderProfitShare {
  id: string;
  orderId: string;
  name: string;
  // Basis points — 5000 = 50%. Governs PROFIT only.
  shareBps: number;
  // Cents of this order's COSTS this person paid up front, before Ascend's bank
  // paid for orders. History: what was still unpaid at the cutover became
  // their advance (capitalFundingId), and nothing writes it any more.
  capitalAmount: number;
  capitalFundingId?: string | null;
  partnerId: string | null;
  /** The partner as they are now — `name` above is frozen as saved. */
  partner?: { name: string; kind: PartnerKind } | null;
  createdAt: string;
  updatedAt: string;
}

/** A row of an order's split as sent to the API — by partner, never a typed name. */
export interface OrderProfitShareInput {
  partnerId: string;
  shareBps: number;
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

/** PERSON gets paid out; COMPANY is Ascend — its share stays in the bank. */
export type PartnerKind = 'PERSON' | 'COMPANY';

export interface Partner {
  id: string;
  name: string;
  kind: PartnerKind;
  active: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerBalance {
  partnerId: string;
  name: string;
  active: boolean;
  /** Nothing references them, so they can be deleted outright rather than only
   *  deactivated. Computed server-side — zero balances do not imply this. */
  removable?: boolean;
  kind: PartnerKind;
  earned: number;
  /** The part of `earned` on orders not shared out yet. */
  toShare: number;
  /** Capital fronted on orders, ever — history since the bank pays for orders. */
  capitalFronted: number;
  /** Fronted capital still due and not yet moved into an advance. */
  capitalOwed: number;
  /** Capital they never want back — deliberately absent from `owed`. */
  contributed: number;
  advancesTotal: number;
  advancesRepaid: number;
  advancesOutstanding: number;
  paidOut: number;
  /** toShare + capitalOwed + advancesOutstanding − payouts on account */
  owed: number;
}

export interface AscendBalance {
  partnerId: string;
  name: string;
  /** Ascend's share of every costed order's profit — kept in the bank. */
  retained: number;
  /** The part of `retained` on orders not shared out yet. */
  toKeep: number;
}

export interface PartnerRef {
  id: string;
  name: string;
}

/**
 * OPERATING spending is consumed on purchase and reduces net profit now.
 * INVENTORY spending bought stock, and becomes a cost only as COGS when the
 * goods sell — counting it in both places is what double-charged stock.
 */
export type ExpenseKind = 'OPERATING' | 'INVENTORY';

export interface CompanyExpense {
  id: string;
  occurredAt: string;
  category: string;
  description: string;
  amount: number;
  kind: ExpenseKind;
  paidByPartnerId: string | null;
  paidBy?: PartnerRef | null;
  funding?: { id: string; type: FundingType; repayments: { amount: number }[] } | null;
  /** Exact number of documents filed against this expense, counted server-side. */
  _count?: { documents: number };
}

/**
 * A filed document — receipt, invoice, courier bill, bank slip, statement.
 *
 * Note there is no `url`. The file is not public: it lives outside the static
 * /uploads mount and is fetched through an authenticated endpoint, so the only
 * way to show one is to request the bytes with the admin token and render the
 * resulting blob. See lib/api.ts → adminFetchDocumentBlob.
 */
export interface Document {
  id: string;
  title: string;
  description: string | null;
  kind: string;
  /** The date ON the document, which is not the upload time. */
  occurredAt: string;
  /** Cents. Null where the document has no amount — a certificate, say. */
  amount: number | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  links: DocumentLink[];
}

/** One attachment of a document to exactly one order or one expense. */
export interface DocumentLink {
  id: string;
  documentId: string;
  orderId: string | null;
  expenseId: string | null;
  order?: {
    id: string;
    orderNumber: string;
    customerName: string;
    total: number;
    createdAt: string;
  } | null;
  expense?: {
    id: string;
    description: string;
    category: string;
    amount: number;
    occurredAt: string;
  } | null;
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
  /** False for money that never touched Ascend's bank. */
  throughBank?: boolean;
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
  runId?: string | null;
}

export interface PartnerEarning {
  orderId: string;
  orderNumber: string;
  occurredAt: string;
  shareBps: number;
  orderProfit: number;
  amount: number;
  costed: boolean;
  /** Money went back to the customer, so this order earned less — or nothing. */
  refunded: boolean;
  capitalAmount: number;
  shared: boolean;
  sharedAt: string | null;
  /** Shared by hand, outside the system. */
  sharedOutside: boolean;
}

export interface FinanceOverview {
  /** Net takings across every order the money arrived on, costed or not. */
  revenue: number;
  refunded: number;
  /** The part of `revenue` whose costs are known. */
  costedRevenue: number;
  /** Real money in, profit unknowable until someone prices the lines. */
  uncostedRevenue: number;
  cogs: number;
  extraCosts: number;
  gatewayFees: number;
  /** costedRevenue − cogs − extraCosts − gatewayFees. */
  grossOrderProfit: number;
  /** The only expense figure that reduces net profit. */
  operatingSpend: number;
  /** Spending that bought stock — a cost later, as COGS, not now. */
  inventoryPurchased: number;
  /** Every expense row added up, whatever its kind. */
  companySpend: number;
  /** inventoryPurchased − cogs. Negative means purchases predate the system. */
  stockOnHand: number;
  netProfit: number;
  totalContributed: number;
  totalAdvancesOutstanding: number;
  totalPaidOut: number;
  costedOrders: number;
  uncostedOrders: number;
  partners: PartnerBalance[];
  ascend: AscendBalance | null;
  recentActivity: FinanceActivity[];
}

/* -------------------------------------------------------------- Ascend Money */

export type BankSource =
  | 'OPENING' | 'MONEY_IN' | 'MONEY_OUT' | 'SALE' | 'REFUND' | 'CAPITAL' | 'EXPENSE' | 'PAYOUT' | 'REPAYMENT';

export interface BankMovement {
  key: string;
  source: BankSource;
  occurredAt: string;
  /** Signed cents: positive in, negative out. */
  amount: number;
  description: string;
  partnerName: string | null;
  ref: { type: 'bank_entry' | 'order' | 'funding' | 'expense' | 'payout_run' | 'payout' | 'repayment'; id: string; label?: string };
  /** Running balance after this movement. */
  balance: number;
}

export interface BankCheck {
  id: string;
  checkedAt: string;
  statementBalance: number;
  bookBalance: number;
  difference: number;
  note: string | null;
  createdBy: string | null;
}

export interface BankFlows {
  opening: number;
  moneyIn: number;
  moneyOut: number;
  closing: number;
}

export interface BankLedger {
  started: boolean;
  startedAt: string | null;
  balance: number;
  flows: BankFlows;
  /** Newest first. */
  movements: BankMovement[];
  checks: BankCheck[];
  lastCheck: BankCheck | null;
}

export interface SplitRuleShare {
  partnerId: string;
  name: string;
  kind: PartnerKind;
  shareBps: number;
}

export interface SplitRule {
  id: string;
  effectiveFrom: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  shares: SplitRuleShare[];
}

export interface ShareOutPart extends SplitRuleShare {
  /** Null while the order is not costed. */
  amount: number | null;
}

export interface ShareOutOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  status: Order['status'];
  paymentStatus: Order['paymentStatus'];
  paidAt: string;
  revenue: number;
  profit: number | null;
  costed: boolean;
  shared: boolean;
  parts: ShareOutPart[];
}

export interface PayoutRunSummary {
  id: string;
  occurredAt: string;
  note: string | null;
  /** Shared by hand, outside the system — no payouts. */
  legacy: boolean;
  createdBy: string | null;
  total: number;
  payouts: { partnerId: string; name: string; amount: number }[];
  orders: { id: string; orderNumber: string }[];
}

export interface ShareOutQueue {
  ready: ShareOutOrder[];
  waiting: {
    needsCosting: { id: string; orderNumber: string; paidAt: string }[];
    /** Costed, but the split is missing a partner or not 100%. */
    needsSplit: { id: string; orderNumber: string; paidAt: string }[];
    onTheWay: { id: string; orderNumber: string; status: Order['status']; paidAt: string }[];
  };
  runs: PayoutRunSummary[];
}

export interface MoneyOverview {
  period: {
    from: string | null;
    to: string | null;
    revenue: number;
    refunded: number;
    costedRevenue: number;
    uncostedRevenue: number;
    cogs: number;
    extraCosts: number;
    gatewayFees: number;
    grossOrderProfit: number;
    operatingSpend: number;
    inventoryPurchased: number;
    netProfit: number;
    costedOrders: number;
    uncostedOrders: number;
    ascendKept: number;
    earnedByPerson: { partnerId: string; name: string; earned: number }[];
  };
  bank: {
    started: boolean;
    startedAt: string | null;
    balance: number;
    flows: BankFlows;
    lastCheck: BankCheck | null;
    daysSinceCheck: number | null;
    recent: BankMovement[];
  };
  ascend: AscendBalance | null;
  partners: PartnerBalance[];
  stockOnHand: number;
  totalAdvancesOutstanding: number;
  readyToShare: { orders: number; people: { partnerId: string; name: string; amount: number }[]; ascend: number; total: number };
  waiting: { needsCosting: number; needsSplit: number; onTheWay: number };
  splitRule: SplitRule | null;
  nextSplitRule: SplitRule | null;
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
  balance: PartnerBalance | null;
  /** Set when the partner is Ascend itself. */
  ascend: AscendBalance | null;
  earnings: PartnerEarning[];
  funding: PartnerFunding[];
  payouts: ProfitPayout[];
}

// ---------------------------------------------------------------------------
// Shadow SKUs — the generalised internal vocabulary
// ---------------------------------------------------------------------------

export interface ShadowSku {
  id: string;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** How many real SKUs currently map to it. */
  variantCount: number;
}

/** One real, sellable SKU and what it is listed as internally. */
export interface ShadowMappingRow {
  id: string;
  code: string;
  size: string | null;
  active: boolean;
  shadowSkuId: string | null;
  displayName: string;
  orderLineCount: number;
  product: { id: string; name: string; categoryId: string };
  shadowSku: { id: string; code: string; name: string; active: boolean } | null;
}

export interface ShadowCoverage {
  activeVariants: number;
  mapped: number;
  unmapped: number;
  shadowCount: number;
  activeShadowCount: number;
}

export interface ShadowSummaryLine {
  itemId: string;
  quantity: number;
  unitPrice: number;
  /** What the sheet prints. */
  code: string;
  name: string;
  /** What it really is — operator-facing, never on the PDF. */
  realName: string;
  realCode: string;
}

export interface ShadowSummary {
  order: {
    id: string;
    orderNumber: string;
    createdAt: string;
    subtotal: number;
    shippingFee: number;
    discountAmount: number;
    total: number;
    status: string;
    paymentStatus: string;
  };
  lines: ShadowSummaryLine[];
  /** `variantId` is the SKU to map — the dialog closes the gap in place. */
  unmapped: { itemId: string; variantId: string; quantity: number; realName: string; realCode: string }[];
  complete: boolean;
}

/** One order in the shadow backlog: can a sheet be produced, and has one been. */
export interface ShadowOrderRow {
  id: string;
  orderNumber: string;
  createdAt: string;
  total: number;
  status: string;
  paymentStatus: string;
  lineCount: number;
  complete: boolean;
  unmappedCount: number;
}

// ---------------------------------------------------------------------------
// Supplier price list
// ---------------------------------------------------------------------------

export interface Supplier {
  id: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** SKUs this supplier has a price for. */
  priceCount: number;
  /** Costed order lines that took this supplier's price. */
  orderLineCount: number;
}

/** One sellable SKU and every supplier's per-unit price for it, in cents. */
export interface SupplierSheetRow {
  variantId: string;
  code: string;
  size: string | null;
  productId: string;
  productName: string;
  displayName: string;
  costs: Record<string, number>;
}

export interface SupplierSheet {
  suppliers: { id: string; name: string; active: boolean }[];
  rows: SupplierSheetRow[];
}

/** What the costing sheet's dropdown offers for one SKU: cheapest first. */
export interface SupplierOption {
  supplierId: string;
  name: string;
  cost: number;
}

export type PaymentFailureReason = 'DECLINED' | 'ABANDONED_MID_PAYMENT' | 'NO_ATTEMPT' | 'NEVER_OPENED' | 'NO_BILL' | 'UNKNOWN';

/** One try at paying, exactly as the gateway listed it (backend PaymentAttempt). */
export interface PaymentAttempt {
  id: string;
  gateway: string;
  externalId: string;
  status: 'completed' | 'failed' | 'pending' | 'opened';
  channel: string | null;
  amount: number | null;
  attemptedAt: string | null;
  completedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  raw: Record<string, unknown>;
}

export type PaymentEventType =
  | 'ORDER_PLACED' | 'BILL_CREATED' | 'BILL_FAILED' | 'PAGE_OPENED' | 'RETURNED' | 'CALLBACK'
  | 'GATEWAY_CHECK' | 'GATEWAY_CHECK_FAILED' | 'PAID' | 'RELEASED' | 'LATE_PAYMENT';

export interface PaymentDevice {
  os: string;
  browser: string;
  inApp?: string;
  mobile: boolean;
}

export interface PaymentClient {
  userAgent?: string;
  country?: string;
  referrer?: string;
  device: PaymentDevice;
}

/** Something that happened to an order's payment (backend PaymentEvent). */
export interface PaymentEvent {
  id: string;
  type: PaymentEventType;
  gateway: string | null;
  at: string;
  data: Record<string, any>;
}

export interface PaymentFailedOrderRow {
  id: string;
  orderNumber: string;
  createdAt: string;
  total: number;
  customerName: string;
  gateway: string | null;
  reason: PaymentFailureReason;
  channel: string | null;
  attempts: { failed: number; pending: number; channels: string[] };
  tracked: boolean;
  opens: number;
  openSources: string[];
  returns: number;
  lastReturnPaid: string | null;
  device: PaymentDevice | null;
  isTest: boolean;
  recoveredBy: { id: string; orderNumber: string; total: number; method: string; gateway: string | null; hoursLater: number } | null;
}

export interface PaymentAnalytics {
  period: { days: number; since: string | null; gateway: 'all' | 'billplz' | 'toyyibpay'; includeTests: boolean };
  trackingSince: string | null;
  totals: {
    orders: number; paid: number; paidAmount: number; open: number; openAmount: number;
    failed: number; failedAmount: number; recovered: number; recoveredAmount: number;
    lost: number; lostAmount: number; conversion: number | null;
  };
  funnel: { placed: number; billCreated: number; billFailed: number; tracked: number; opened: number; attempted: number; paid: number };
  reasons: { reason: PaymentFailureReason; orders: number; amount: number; recovered: number; lost: number; lostAmount: number }[];
  attempts: {
    total: number; completed: number; failed: number; pending: number; ordersAttempted: number;
    paidFirstTry: number; paidAfterRetry: number; failureRate: number | null;
    byChannel: { channel: string; attempts: number; completed: number; failed: number; pending: number; orders: number; paidOrders: number }[];
  };
  byGateway: { gateway: string; orders: number; paid: number; failed: number; paidAmount: number }[];
  devices: { device: string; orders: number; paid: number; failed: number; open: number }[];
  timing: { medianMinutesToPay: number | null; medianMinutesToFirstOpen: number | null };
  failedOrders: PaymentFailedOrderRow[];
}
