// Which slice of the business a turn is about — and therefore which tools and
// which rules the model needs in front of it.
//
// The agent has 62 tools. Sent flat on every turn they cost roughly 7,800
// tokens of schema before the operator has said anything, and they make the
// model's job harder rather than easier: picking `record_payout` out of a list
// of 62 is a materially worse decision than picking it out of a list of 12.
// Tool-selection accuracy is the thing operators experience as "the agent is
// dumb", so the list is narrowed per turn.
//
// Narrowing is done in code, from keywords, NOT by asking the model which
// domain it wants. A routing round-trip would add latency to every message and
// hand the same weak model a second chance to choose wrongly. When routing
// misses, `load_context` (see agent.service.ts) lets the model widen mid-turn.
//
// Nothing here is a security boundary. `runTool` still resolves tools from the
// full registry and still enforces the write/destructive gates, so a model that
// names an unrouted tool gets it — correctly, with every check intact. This
// file only decides what to *advertise*.

export const DOMAINS = [
  'catalog',
  'orders',
  'finance',
  'promos',
  'content',
  'ops',
  'reports',
  'delivery',
  'reminders',
] as const;

export type Domain = (typeof DOMAINS)[number];

// Tools every turn gets regardless of routing. These are the cheap reads that
// answer the most common questions outright and, more importantly, let the
// model orient itself when the router guessed wrong — it can look an order or a
// product up and then reach for `load_context` knowing what it is dealing with.
export const CORE_TOOL_NAMES = [
  'search_products',
  'get_product',
  'list_orders',
  'get_order',
  'dashboard_stats',
  'list_low_stock',
  // Memory writes are offered on every turn: the operator explains how
  // something works in the middle of asking about an order, and a router that
  // only sees "order" would leave the agent unable to keep it.
  'memory_block_append',
  'memory_block_replace',
];

// Used when nothing matched. Orders and catalog are what operators ask about
// most, so an unrouted turn lands somewhere useful rather than bare.
const FALLBACK_DOMAINS: Domain[] = ['orders', 'catalog'];

// Operators type a mix of English and Malay, and abbreviate constantly. Keyword
// lists are deliberately generous: a false positive costs a few hundred tokens
// of unused schema, a false negative costs a round trip through load_context.
//
// Matching is prefix-anchored, not infix (see MATCHERS). "order" therefore
// catches "orders" and "ordered", but "top" no longer fires on "stop" and "cost"
// no longer fires on "costume" — infix matching had reports loading on half the
// messages in the shop.
const KEYWORDS: Record<Domain, string[]> = {
  catalog: [
    'product', 'produk', 'variant', 'size', 'saiz', 'stock', 'stok', 'inventory',
    'price', 'harga', 'pricing', 'on sale', 'sale price', 'sold out', 'restock',
    'vial', 'peptide', 'compound', 'addon', 'add-on', 'category', 'kategori', 'sku',
  ],
  orders: [
    'order', 'pesanan', 'checkout', 'paid', 'unpaid', 'payment', 'bayar',
    'bayaran', 'refund', 'cancel', 'batal', 'customer', 'pelanggan', 'invoice',
    'receipt', 'resit', 'shipped', 'delivered', 'pending', 'cost', 'kos',
    'profit', 'untung', 'margin', 'asc25', 'asc26', 'transfer', 'proof',
  ],
  finance: [
    'expense', 'perbelanjaan', 'belanja', 'spending', 'funding', 'capital',
    'modal', 'contribution', 'advance', 'repayment', 'payout', 'partner',
    'rakan', 'withdraw', 'balance', 'cash', 'runway', 'owe', 'hutang', 'debt',
  ],
  promos: ['discount', 'diskaun', 'promo', 'coupon', 'voucher', 'code', 'kod', 'percent'],
  content: ['insight', 'article', 'artikel', 'blog', 'post', 'content', 'kandungan', 'write up', 'copy'],
  ops: [
    'setting', 'tetapan', 'config', 'email', 'emel', 'outbox', 'operator',
    'access', 'akses', 'allowlist', 'group', 'kumpulan', 'admin', 'enable',
    'disable', 'switch on', 'switch off', 'gateway', 'shipping fee',
  ],
  reports: [
    'report', 'laporan', 'analytics', 'stats', 'statistic', 'revenue', 'sales',
    'jualan', 'total', 'jumlah', 'breakdown', 'top ', 'best', 'trend', 'month',
    'bulan', 'week', 'minggu', 'compare', 'query', 'sql', 'database',
  ],
  delivery: [
    'delivery', 'penghantaran', 'hantar', 'deliver', 'courier', 'kurier',
    'schedule', 'jadual', 'dispatch', 'tracking', 'pickup', 'drop',
  ],
  reminders: ['remind', 'reminder', 'peringatan', 'ingatkan', 'nudge', 'later', 'nanti', 'follow up', 'alarm'],
};

// ------------------------------------------------------------------ playbooks
//
// The business rules that used to sit in the system prompt on every turn.
//
// These are explanatory, not protective: they describe how Ascend MY operates so
// the model stops proposing things that are not how the shop works. Everything
// that *guards* something — the injection boundary, the never-claim-a-write
// rule, what the agent cannot do, the care rules around regulated compounds —
// deliberately stayed in the always-on prompt. A safety rule that only loads
// when a keyword matches is not a safety rule.
//
// Text is carried over verbatim from the original prompt. It was worded that
// precisely because of specific mistakes the agent made; this is a move, not a
// rewrite.

interface Playbook {
  title: string;
  body: string;
}

const PLAYBOOKS: Record<string, Playbook> = {
  checkout: {
    title: 'How an order arrives',
    body: `Three checkout paths, and they behave very differently:
- *WhatsApp checkout* (paymentMethod WHATSAPP). The customer is handed a pre-filled wa.me link at checkout and messages the shop's public number. Payment is arranged by hand, usually a bank transfer, and the customer sends proof. Nothing is automatic. A human confirms the money arrived and marks the order paid. There is NO payment link to send and no automated chase — this path is a conversation between two people.
- *Online payment*. The customer pays at checkout through the store's fiat gateway and it calls back to mark the order paid. Once such an order is PAID it is LOCKED — its payment status can never be changed again, deliberately. A sweep also releases stock from online orders left unpaid for more than two hours.
  Naming: the database stores this payment method as the enum value "BILLPLZ" for historical reasons. That is NOT the gateway in use — it only means "paid online", and the live gateway is the one named in STORE STATE. Never LABEL an order or a figure "Billplz": call it "online payment" or use the real gateway's name. You may explain the legacy enum name if someone asks specifically why the data says BILLPLZ, but do not volunteer it in routine answers.
- *Crypto* (paymentMethod CRYPTO). Bitcoin, on-chain, always settled by the self-hosted BTCPay Server — never by the fiat gateway, and the "payment_gateway" setting has no bearing on it. It is a SEPARATE payment method offered alongside the other two, not a third choice of online gateway: crypto being switched on or off ("crypto_payment_enabled") says nothing about whether FPX is on. Same PAID lock as online payment. Two things differ: settlement is not instant, because it waits for on-chain confirmation, so a CRYPTO order sitting UNPAID for a while is normal rather than a problem; and the stock-release sweep gives it 24 hours instead of two, because a slow-confirming payment is still a real one. There is no such thing as a crypto refund you can issue from here — moving Bitcoin back is a manual, human action.`,
  },

  statuses: {
    title: 'What each change actually causes',
    body: `These are real consequences, not labels:
- Marking an order PAID queues the customer's payment-receipt email and records the revenue for reporting. Do not mark an order paid to "tidy it up"; it means money genuinely arrived.
- Marking an order CANCELLED, FAILED or REFUNDED returns its stock to inventory.
- REFUNDED restores stock but, on ToyyibPay, does NOT move money — it has no refund API, so a human still has to issue the refund in the ToyyibPay dashboard. Always say this out loud when recording a refund on a ToyyibPay order.
- Order status (PENDING → CONFIRMED → SHIPPED → DELIVERED) is fulfilment. Payment status (UNPAID/PAID/FAILED/REFUNDED) is money. They move independently: a WhatsApp order is routinely still UNPAID while the customer arranges a transfer.
- Stock is taken when the order is placed, not when it ships.`,
  },

  moneyflow: {
    title: 'Money, from a sale to a person’s pocket',
    body: `In this order:
1. The order records what the customer paid (items, shipping, discount).
2. Someone enters what it *cost* — a per-unit cost on every line, plus extra costs like courier or packaging. Until every line has a cost, profit for that order is genuinely unknown and must be reported as unknown, never as zero.
3. That order's profit is split between people by percentage, and each person can also carry a flat share of the running costs.
4. Separately, the finance side tracks company spending, money partners put in, and money paid back out. Money in is either a CONTRIBUTION (capital, never repaid) or an ADVANCE (a debt the company owes back). These are not interchangeable — ask which one if it is not stated.`,
  },

  products: {
    title: 'How the catalogue is shaped',
    body: `A product is a compound with one page; the sellable sizes are its variants, and price and stock live on the variant. Add-ons are other variants offered alongside a product (bacteriostatic water, syringes, swabs); a required add-on is forced into the basket and cannot be unticked.`,
  },
};

// Which playbooks a domain needs. Orders pull two because an order question is
// almost always really a question about payment state or its consequences.
const DOMAIN_PLAYBOOKS: Record<Domain, string[]> = {
  catalog: ['products'],
  orders: ['checkout', 'statuses'],
  finance: ['moneyflow'],
  promos: [],
  content: [],
  ops: [],
  reports: ['moneyflow'],
  delivery: ['statuses'],
  reminders: [],
};

// ------------------------------------------------------------------- routing

// One regex per domain, anchored at a word boundary but deliberately open at
// the end so a keyword matches its own inflections — "order" hits "orders" and
// "ordered" without needing every form listed.
const MATCHERS: Record<Domain, RegExp> = Object.fromEntries(
  DOMAINS.map((d) => [
    d,
    new RegExp(`\\b(${KEYWORDS[d].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i'),
  ])
) as Record<Domain, RegExp>;

/**
 * Pick the domains a turn is about. Takes everything that matched rather than
 * the single best domain — real messages cross domains constantly ("mark it
 * paid and record the courier cost").
 */
export function routeDomains(text: string): Domain[] {
  const hits = DOMAINS.filter((d) => MATCHERS[d].test(text));
  return hits.length ? hits : [...FALLBACK_DOMAINS];
}

/** The rules text for a set of domains, deduplicated. Empty string if none. */
export function playbooksFor(domains: Iterable<Domain>): string {
  const wanted = new Set<string>();
  for (const d of domains) for (const p of DOMAIN_PLAYBOOKS[d] ?? []) wanted.add(p);
  if (!wanted.size) return '';

  const blocks = [...wanted].map((key) => {
    const pb = PLAYBOOKS[key];
    return `### ${pb.title}\n${pb.body}`;
  });

  return `HOW THIS BUSINESS ACTUALLY WORKS\nRead this before suggesting a next step. Most mistakes here come from proposing something that is not how Ascend MY operates.\n\n${blocks.join('\n\n')}`;
}

/**
 * One line per domain NOT already loaded, so the model knows what it could ask
 * for. Without this `load_context` is invisible — it cannot request a domain it
 * has never heard of.
 */
export function domainMenu(loaded: Iterable<Domain>): string {
  const have = new Set(loaded);
  const rest = DOMAINS.filter((d) => !have.has(d));
  if (!rest.length) return '';
  return rest.map((d) => `- ${d}: ${DOMAIN_BLURB[d]}`).join('\n');
}

const DOMAIN_BLURB: Record<Domain, string> = {
  catalog: 'products, variants, stock levels, prices, sales, add-ons',
  orders: 'orders, payment status, order costs, profit shares, receipts',
  finance: 'expenses, partner funding, advances, repayments, payouts',
  promos: 'discount codes',
  content: 'insight articles and site copy',
  ops: 'store settings, email outbox, operator and group access',
  reports: 'sales analytics, breakdowns, inventory reports, database queries',
  delivery: 'delivery scheduling and the delivery run',
  reminders: 'reminders for the operators',
};
