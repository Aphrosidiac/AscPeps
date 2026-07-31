import type { AgentTool } from '../tool-kit.js';
import { clampLimit, money, parseDate, truncate } from '../tool-kit.js';
import { getAnalytics, getDashboardStats } from '../../admin/admin-dashboard.controller.js';

// Reporting. The fixed reports below cover the questions that get asked
// weekly; `run_report_query` is what makes the rest possible, because no fixed
// menu of reports survives contact with "actually, can you break that down by
// state for repeat customers only". It is a genuine SQL escape hatch, and the
// safety comes from the database rather than from string matching — see below.

// Raw Postgres returns BIGINT for count()/sum() aggregates, which arrives as a
// JavaScript BigInt. JSON.stringify throws outright on BigInt ("Do not know how
// to serialize a BigInt"), so every raw result must go through this before it
// can be handed back to the model. Losing precision above 2^53 is irrelevant
// here — these are order counts and cent totals for one small business.
function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]));
  }
  return value;
}

// The tables the agent is allowed to read, and what they mean. Handed to the
// model on demand rather than baked into the system prompt — it is long, and
// only matters once the model actually reaches for SQL.
const SCHEMA_NOTES = `
All money columns are INTEGER CENTS. Divide by 100 for ringgit.

categories(id, name, slug, "sortOrder")
products(id, name, slug, "categoryId", description, benefits, "dosageInfo",
         featured, active, "addOnOnly", "createdAt")
  - a product is a compound/product line, NOT a sellable SKU.
product_variants(id, "productId", code, size, price, "salePrice",
         "saleStartsAt", "saleEndsAt", stock, active, "createdAt")
  - the sellable SKU. price/salePrice in cents.
product_add_ons(id, "productId", "addOnId", required, quantity)

orders(id, "orderNumber", "customerName", phone, email, address, city, state,
       postcode, subtotal, "shippingFee", "discountAmount", total, status,
       "paymentMethod", "paymentStatus", "paymentGateway", "trackingNumber",
       "discountCodeId", notes, "deletedAt", "createdAt")
  - status: PENDING|CONFIRMED|SHIPPED|DELIVERED|CANCELLED
  - "paymentStatus": UNPAID|PAID|FAILED|REFUNDED
  - "paymentMethod": WHATSAPP|BILLPLZ. BILLPLZ is a legacy enum name meaning
    "paid online" — it does NOT mean the Billplz gateway. The gateway actually
    used is the "paymentGateway" column (e.g. 'toyyibpay'). When reporting,
    label it "online payment", never "Billplz".
  - IMPORTANT: always filter "deletedAt" IS NULL unless deleted orders are
    explicitly wanted. Real revenue means "paymentStatus" = 'PAID'.
order_items(id, "orderId", "productId" AS the variant id, quantity,
       "unitPrice", "unitCost")
  - NOTE the column is literally named "productId" but holds a
    product_variants.id (renamed in Prisma only). Join accordingly.
  - "unitCost" is NULL until an admin prices the line.
order_extra_costs(id, "orderId", label, amount)
order_profit_shares(id, "orderId", "partnerId", name, "shareBps",
       "expenseAmount")
  - "shareBps" is basis points: 5000 = 50%.

discount_codes(id, code, description, "discountType", "discountValue",
       "minOrderAmount", "maxUses", "usedCount", "isActive", "expiresAt")
insights(id, title, slug, category, excerpt, published, "publishedAt")
insight_figures(id, "insightId", "order", "imageUrl", caption)
email_outbox(id, "orderId", type, "toEmail", status, attempts, "sentAt")

partners(id, name, active, notes)
company_expenses(id, "occurredAt", category, description, amount,
       "paidByPartnerId")
partner_funding(id, "partnerId", type, amount, "occurredAt", description,
       "expenseId")   -- type: CONTRIBUTION|ADVANCE
partner_repayments(id, "fundingId", amount, "occurredAt")
profit_payouts(id, "partnerId", amount, "occurredAt")

agent_tool_calls(id, "actorPhone", "toolName", ok, destructive, "createdAt")

Postgres. Identifiers are camelCase and MUST be double-quoted.
`.trim();

export const reportTools: AgentTool[] = [
  {
    name: 'dashboard_stats',
    description: 'Headline numbers: revenue, order counts by status, recent orders, low stock. The quick "how are we doing".',
    input_schema: { type: 'object', properties: {} },
    run: async ({ fastify }) => jsonSafe(await getDashboardStats(fastify)),
  },

  {
    name: 'sales_analytics',
    description:
      'Revenue, costs, net profit and profit share over a period, plus the daily series. Profit is computed only over paid orders that are fully costed, and reports how many were excluded for being uncosted.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'number', description: 'Look-back window in days. Default 30.' } },
    },
    run: async ({ fastify }, input) => jsonSafe(await getAnalytics(fastify, { days: String(input.days ?? 30) })),
  },

  {
    name: 'top_products',
    description: 'Best sellers over a period, by units sold and by revenue. Counts paid, non-deleted orders only.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'YYYY-MM-DD, "today", "30d". Default 30d.' },
        to: { type: 'string' },
        by: { type: 'string', enum: ['revenue', 'units'], description: 'Sort key. Default revenue.' },
        limit: { type: 'number' },
      },
    },
    run: async ({ prisma }, input) => {
      const from = parseDate(input.from ?? '30d', false)!;
      const to = parseDate(input.to, true);
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT p.name AS product, v.code, v.size,
                SUM(oi.quantity)::bigint             AS units,
                SUM(oi.quantity * oi."unitPrice")::bigint AS revenue,
                COUNT(DISTINCT o.id)::bigint         AS orders
           FROM order_items oi
           JOIN orders o           ON o.id = oi."orderId"
           JOIN product_variants v ON v.id = oi."productId"
           JOIN products p         ON p.id = v."productId"
          WHERE o."deletedAt" IS NULL
            AND o."paymentStatus" = 'PAID'
            AND o."createdAt" >= $1
            AND ($2::timestamp IS NULL OR o."createdAt" <= $2)
          GROUP BY p.name, v.code, v.size
          ORDER BY ${input.by === 'units' ? 'units' : 'revenue'} DESC
          LIMIT ${clampLimit(input.limit, 15)}`,
        from,
        to ?? null
      );
      return {
        period: { from, to: to ?? 'now' },
        products: rows.map((r) => ({
          product: r.product,
          code: r.code,
          size: r.size,
          units: Number(r.units),
          orders: Number(r.orders),
          revenue: money(Number(r.revenue)),
        })),
      };
    },
  },

  {
    name: 'customer_report',
    description:
      'Top customers by spend, with order counts and repeat behaviour. Customers are identified by phone number, since there are no user accounts.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Default: all time.' },
        to: { type: 'string' },
        repeatOnly: { type: 'boolean', description: 'Only customers with more than one paid order.' },
        limit: { type: 'number' },
      },
    },
    run: async ({ prisma }, input) => {
      const from = parseDate(input.from, false);
      const to = parseDate(input.to, true);
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT phone,
                MAX("customerName")   AS name,
                MAX(state)            AS state,
                COUNT(*)::bigint      AS orders,
                SUM(total)::bigint    AS spend,
                MAX("createdAt")      AS last_order
           FROM orders
          WHERE "deletedAt" IS NULL
            AND "paymentStatus" = 'PAID'
            AND ($1::timestamp IS NULL OR "createdAt" >= $1)
            AND ($2::timestamp IS NULL OR "createdAt" <= $2)
          GROUP BY phone
          ${input.repeatOnly ? 'HAVING COUNT(*) > 1' : ''}
          ORDER BY spend DESC
          LIMIT ${clampLimit(input.limit, 20)}`,
        from ?? null,
        to ?? null
      );
      const totals: any[] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(DISTINCT phone)::bigint AS customers,
                COUNT(*) FILTER (WHERE c > 1)::bigint AS repeat_customers
           FROM (SELECT phone, COUNT(*) AS c FROM orders
                  WHERE "deletedAt" IS NULL AND "paymentStatus" = 'PAID'
                  GROUP BY phone) s`
      );
      const t = totals[0] ?? {};
      return {
        totalCustomers: Number(t.customers ?? 0),
        repeatCustomers: Number(t.repeat_customers ?? 0),
        customers: rows.map((r) => ({
          name: r.name,
          phone: r.phone,
          state: r.state,
          orders: Number(r.orders),
          spend: money(Number(r.spend)),
          lastOrder: r.last_order,
        })),
      };
    },
  },

  {
    name: 'inventory_report',
    description: 'Stock position across the catalogue: units on hand, retail value, and what is out of or low on stock.',
    input_schema: {
      type: 'object',
      properties: { lowStockThreshold: { type: 'number', description: 'Default 10.' } },
    },
    run: async ({ prisma }, input) => {
      const threshold = Number.isFinite(input.lowStockThreshold) ? Math.trunc(input.lowStockThreshold) : 10;
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::bigint                                  AS variants,
                SUM(stock)::bigint                                AS units,
                SUM(stock * price)::bigint                        AS retail_value,
                COUNT(*) FILTER (WHERE stock = 0)::bigint         AS out_of_stock,
                COUNT(*) FILTER (WHERE stock > 0 AND stock <= $1)::bigint AS low_stock
           FROM product_variants v
           JOIN products p ON p.id = v."productId"
          WHERE v.active AND p.active`,
        threshold
      );
      const r = rows[0] ?? {};
      const outOfStock = await prisma.productVariant.findMany({
        where: { stock: 0, active: true, product: { active: true } },
        include: { product: true },
        take: 25,
      });
      return {
        activeVariants: Number(r.variants ?? 0),
        unitsOnHand: Number(r.units ?? 0),
        retailValue: money(Number(r.retail_value ?? 0)),
        outOfStockCount: Number(r.out_of_stock ?? 0),
        lowStockCount: Number(r.low_stock ?? 0),
        threshold,
        outOfStock: outOfStock.map((v) => ({ product: v.product.name, code: v.code, size: v.size })),
      };
    },
  },

  {
    name: 'sales_breakdown',
    description:
      'Group paid revenue by a dimension over a period — by day, month, state, city, payment method, status, or category. Use this for "how much did we make in Selangor" or "revenue by month this year".',
    input_schema: {
      type: 'object',
      properties: {
        groupBy: {
          type: 'string',
          enum: ['day', 'week', 'month', 'state', 'city', 'paymentMethod', 'status', 'category'],
        },
        from: { type: 'string', description: 'Default 30d.' },
        to: { type: 'string' },
        limit: { type: 'number' },
      },
      required: ['groupBy'],
    },
    run: async ({ prisma }, input) => {
      const from = parseDate(input.from ?? '30d', false)!;
      const to = parseDate(input.to, true);

      // Whitelist -> SQL fragment. The value never reaches the query as text,
      // so the enum is the only thing that can select a grouping.
      const grouping: Record<string, { expr: string; join: string }> = {
        day: { expr: `to_char(o."createdAt", 'YYYY-MM-DD')`, join: '' },
        week: { expr: `to_char(date_trunc('week', o."createdAt"), 'YYYY-MM-DD')`, join: '' },
        month: { expr: `to_char(o."createdAt", 'YYYY-MM')`, join: '' },
        state: { expr: `o.state`, join: '' },
        city: { expr: `o.city`, join: '' },
        paymentMethod: { expr: `o."paymentMethod"::text`, join: '' },
        status: { expr: `o.status::text`, join: '' },
        category: {
          expr: `c.name`,
          join: `JOIN order_items oi ON oi."orderId" = o.id
                 JOIN product_variants v ON v.id = oi."productId"
                 JOIN products p ON p.id = v."productId"
                 JOIN categories c ON c.id = p."categoryId"`,
        },
      };
      const g = grouping[input.groupBy];
      if (!g) throw new Error(`Unsupported groupBy "${input.groupBy}".`);

      // Grouping by category counts each order once per category line, so its
      // "orders" figure is line-based, not order-based. Flagged in the result
      // rather than silently reported as if it were an order count.
      const revenue = input.groupBy === 'category' ? `SUM(oi.quantity * oi."unitPrice")` : `SUM(o.total)`;

      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT ${g.expr} AS bucket,
                COUNT(DISTINCT o.id)::bigint AS orders,
                ${revenue}::bigint           AS revenue
           FROM orders o
           ${g.join}
          WHERE o."deletedAt" IS NULL
            AND o."paymentStatus" = 'PAID'
            AND o."createdAt" >= $1
            AND ($2::timestamp IS NULL OR o."createdAt" <= $2)
          GROUP BY ${g.expr}
          ORDER BY ${input.groupBy === 'day' || input.groupBy === 'week' || input.groupBy === 'month' ? 'bucket ASC' : 'revenue DESC'}
          LIMIT ${clampLimit(input.limit, 40)}`,
        from,
        to ?? null
      );

      return {
        groupBy: input.groupBy,
        period: { from, to: to ?? 'now' },
        rows: rows.map((r) => ({ bucket: r.bucket, orders: Number(r.orders), revenue: money(Number(r.revenue)) })),
        total: money(rows.reduce((s, r) => s + Number(r.revenue), 0)),
        note:
          input.groupBy === 'category'
            ? 'Revenue here is line-level (item price x quantity), so it excludes shipping and discounts and will not match order totals exactly.'
            : undefined,
      };
    },
  },

  {
    name: 'describe_database',
    description:
      'The database schema — every table, its columns and what they mean. Read this before writing anything with run_report_query.',
    input_schema: { type: 'object', properties: {} },
    run: async () => ({ schema: SCHEMA_NOTES }),
  },

  {
    name: 'run_report_query',
    description:
      'Run a read-only SQL SELECT against the database for any report the other tools do not cover. Postgres syntax, camelCase identifiers must be double-quoted, money is in cents. Call describe_database first if unsure of a column. Only SELECT runs — the query executes inside a read-only transaction, so no write is possible even if attempted.',
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'A single SELECT (or WITH ... SELECT) statement. No semicolon.' },
        purpose: { type: 'string', description: 'One line on what this is answering, for the audit log.' },
      },
      required: ['sql'],
    },
    run: async ({ prisma }, input) => {
      const sql = String(input.sql).trim().replace(/;\s*$/, '');

      // Two independent guards, because a regex alone is not a security
      // boundary. This one catches obvious mistakes and gives a clear error;
      // the READ ONLY transaction below is what actually makes a write
      // impossible, enforced by Postgres rather than by pattern matching.
      if (!/^(select|with)\b/i.test(sql)) {
        throw new Error('Only SELECT (or WITH ... SELECT) queries are allowed.');
      }
      if (sql.includes(';')) {
        throw new Error('Only one statement at a time — remove the semicolon.');
      }

      const rows = await prisma.$transaction(async (tx) => {
        // Postgres refuses any INSERT/UPDATE/DELETE/DDL in this transaction,
        // regardless of what the string contains.
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        // A runaway join must not pin a connection from the pool the
        // storefront is also using.
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '15s'`);
        return tx.$queryRawUnsafe(`SELECT * FROM (${sql}) AS agent_query LIMIT 200`);
      });

      const safe = jsonSafe(rows) as any[];

      // Drop whole rows until the payload fits the context budget. Truncating
      // the serialized JSON mid-string instead would hand the model malformed
      // data it cannot parse and cannot tell is incomplete.
      let shown = safe;
      while (shown.length > 1 && JSON.stringify(shown).length > 6000) {
        shown = shown.slice(0, Math.floor(shown.length / 2));
      }

      return {
        rowCount: safe.length,
        hitRowLimit: safe.length >= 200,
        showing: shown.length,
        omittedForSize: safe.length - shown.length,
        rows: shown,
      };
    },
  },

  {
    name: 'agent_activity_log',
    description: 'What the agent itself has done recently — which tools ran, for whom, and whether they succeeded.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        failedOnly: { type: 'boolean' },
        toolName: { type: 'string' },
      },
    },
    run: async ({ prisma }, input) => {
      const where: any = {};
      if (input.failedOnly) where.ok = false;
      if (input.toolName) where.toolName = input.toolName;
      const rows = await prisma.agentToolCall.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: clampLimit(input.limit, 25),
      });
      return rows.map((r) => ({
        at: r.createdAt,
        tool: r.toolName,
        by: r.actorPhone,
        ok: r.ok,
        destructive: r.destructive,
        durationMs: r.durationMs,
        result: truncate(r.result, 200),
      }));
    },
  },
];
