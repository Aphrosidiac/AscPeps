import type { AgentTool } from '../tool-kit.js';
import { clampLimit, listResult, money, parseDate, rm, summaryOnly, toCents } from '../tool-kit.js';
import {
  adminDeleteOrder,
  adminGetOrder,
  adminResendOrderEmail,
  adminRestoreOrder,
  adminSetOrderDiscount,
  adminSetOrderItems,
  adminUpdateOrder,
  adminUpdateOrderCosts,
  adminUpdateOrderProfitShares,
} from '../../admin/admin-orders.controller.js';
import { createOrder } from '../../orders/orders.controller.js';
import { validateDiscountCode } from '../../admin/admin-discounts.controller.js';
import { getEffectivePrice } from '../../../utils/product-pricing.js';
import { carryDiscount, goodsSubtotal, resolveManualDiscount } from '../../../utils/manual-discount.js';
import { getSupplierOptions } from '../../admin/admin-suppliers.controller.js';
import { resolveSupplier } from './suppliers.tools.js';

// Order tools deliberately delegate to admin-orders.controller.ts wherever a
// controller already exists. That file owns behaviour the agent must never
// reinvent: restoring stock when an order is cancelled/failed/refunded, calling
// the Billplz refund API, refusing to reopen a locked online payment, capturing
// revenue to PostHog for manually-confirmed WhatsApp orders, and enqueuing the
// receipt email inside the same transaction as the status change.

// Resolve whatever the operator said into one order. They will say
// "ASC2507/0042", "the Nurul order", or a bare 42 — never a cuid.
async function resolveOrder(prisma: any, ref: string) {
  const raw = String(ref).trim();
  const direct = await prisma.order.findFirst({
    where: { OR: [{ id: raw }, { orderNumber: raw }, { orderNumber: { equals: raw, mode: 'insensitive' } }] },
  });
  if (direct) return direct;

  // The phone clause is OMITTED when the reference carries no digits, rather
  // than fed a sentinel that cannot match.
  //
  // It used to be `raw.replace(/[^0-9]/g, '') || '\0'` — a literal NUL byte,
  // almost certainly a typo for a space. PostgreSQL text cannot hold a NUL, so
  // every lookup by a digit-less reference ("the Calmant order", "Cecelia")
  // died with `invalid byte sequence for encoding "UTF8": 0x00` instead of
  // searching. Resolving an order by customer name — the single most common
  // way an operator refers to one — could not work at all.
  const digitsOnly = raw.replace(/[^0-9]/g, '');
  const or: any[] = [
    { orderNumber: { contains: raw, mode: 'insensitive' } },
    { customerName: { contains: raw, mode: 'insensitive' } },
  ];
  if (digitsOnly) or.push({ phone: { contains: digitsOnly } });

  const matches = await prisma.order.findMany({
    where: { deletedAt: null, OR: or },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  if (matches.length === 1) return matches[0];

  if (!matches.length) {
    // Substring matching is exact about every character, so one wrong letter
    // is a total miss. On 17 Aug "calment" found nothing while ASC2608/0033
    // sat there under "Calmant", and the agent burned two round trips and an
    // operator's patience before someone spelled it correctly. Operators type
    // names they heard over the phone; the search has to survive that.
    const fuzzy = await fuzzyOrderMatches(prisma, raw);
    if (fuzzy.length === 1) return fuzzy[0];
    if (fuzzy.length > 1) throw new Error(ambiguous(ref, fuzzy, true));
    throw new Error(`No order found matching "${ref}".`);
  }

  // Never guess between candidates on a tool that can cancel or delete —
  // hand the ambiguity back so the operator picks.
  throw new Error(ambiguous(ref, matches, false));
}

function ambiguous(ref: string, matches: any[], fuzzy: boolean): string {
  const list = matches.map((o: any) => `${o.orderNumber} (${o.customerName}, ${rm(o.total)})`).join('; ');
  return fuzzy
    ? `No exact match for "${ref}". Closest are: ${list}. Ask which one — do not assume.`
    : `"${ref}" matches ${matches.length} orders: ${list}. Ask which one.`;
}

/**
 * Trigram similarity fallback, used only after an exact search has found
 * nothing. Requires the pg_trgm extension (see the migration that enables it).
 *
 * `word_similarity` rather than `similarity`, which matters more than it looks.
 * Plain similarity compares two strings WHOLE, so it is diluted by length: an
 * operator typing one name ("calment") against a stored "Calmant Cheah" scores
 * far below any usable threshold purely because the stored value is longer, and
 * a threshold loose enough to catch it matches half the table. word_similarity
 * asks the question actually being asked — is this close to some part of that
 * name — and is unaffected by the rest of the string. Caught by the corpus
 * suite: with plain similarity the misspelling test failed outright.
 *
 * Results are returned as CANDIDATES — resolveOrder never silently commits to
 * one when there are several, because this function exists precisely for the
 * case where the operator's spelling is unreliable.
 */
async function fuzzyOrderMatches(prisma: any, raw: string) {
  if (raw.length < 3) return [];
  try {
    return await prisma.$queryRaw`
      SELECT id, "orderNumber", "customerName", phone, total, status, "paymentStatus", "createdAt"
      FROM orders
      WHERE "deletedAt" IS NULL
        AND (word_similarity(${raw}, "customerName") > 0.45 OR word_similarity(${raw}, "orderNumber") > 0.45)
      ORDER BY GREATEST(word_similarity(${raw}, "customerName"), word_similarity(${raw}, "orderNumber")) DESC
      LIMIT 5`;
  } catch (err) {
    // A box without pg_trgm must degrade to "no fuzzy match", never take the
    // lookup down with it.
    return [];
  }
}

// The stored PaymentMethod enum has only two values, and one of them is
// `BILLPLZ` — a legacy name from when Billplz was the gateway. It does NOT mean
// the order went through Billplz; it means "paid online", and which gateway
// actually ran is `settings.payment_gateway` (ToyyibPay today; Billplz is
// configured but inactive). An order that has actually been billed also records
// the real gateway on `paymentGateway`.
//
// The agent must never say "BILLPLZ" to an operator — it is wrong on its face
// and invites exactly the "why does it say Billplz, we use ToyyibPay" question.
// Renaming the enum would touch orders, payments and the webhooks, so the fix
// lives at the presentation edge instead.
const GATEWAY_NAMES: Record<string, string> = { toyyibpay: 'ToyyibPay', billplz: 'Billplz' };

function gatewayLabel(name?: string | null): string {
  if (!name) return 'online payment';
  return GATEWAY_NAMES[name.toLowerCase()] ?? name;
}

function paymentMethodLabel(o: { paymentMethod: string; paymentGateway?: string | null }, activeGateway?: string): string {
  if (o.paymentMethod !== 'BILLPLZ') return 'WhatsApp (manual bank transfer)';
  // Prefer the gateway the order was actually billed through; fall back to
  // whatever is configured now for orders that never reached a bill.
  return `Online payment (${gatewayLabel(o.paymentGateway ?? activeGateway)})`;
}

async function activeGatewayName(prisma: any): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: 'payment_gateway' } });
  return row?.value ?? 'toyyibpay';
}

function orderSummary(o: any, activeGateway?: string) {
  return {
    orderId: o.id,
    orderNumber: o.orderNumber,
    customer: o.customerName,
    phone: o.phone,
    email: o.email,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: paymentMethodLabel(o, activeGateway),
    total: money(o.total),
    trackingNumber: o.trackingNumber,
    createdAt: o.createdAt,
    deleted: !!o.deletedAt,
  };
}

// Resolves the items an operator described into real variants, and works out
// everything the order will cost — WITHOUT creating anything.
//
// Used for the confirmation summary and again at creation, so the figures the
// operator agrees to are computed the same way the order itself will be. Prices
// always come from the database via getEffectivePrice; a price the model
// suggested is never trusted, exactly as the public checkout never trusts one
// sent by a browser.
async function priceOrderPreview(prisma: any, input: any) {
  if (!Array.isArray(input.items) || !input.items.length) {
    throw new Error('The order needs at least one item.');
  }

  const resolved: { variantId: string; quantity: number; name: string; code: string; unitPrice: number }[] = [];
  for (const raw of input.items) {
    const quantity = Math.trunc(raw.quantity ?? 1);
    if (quantity < 1) throw new Error(`Quantity for "${raw.code ?? raw.variantId}" must be at least 1.`);

    const variant = raw.variantId
      ? await prisma.productVariant.findFirst({
          where: { id: raw.variantId, active: true, product: { active: true } },
          include: { product: true },
        })
      : await prisma.productVariant.findFirst({
          where: { code: { equals: String(raw.code ?? ''), mode: 'insensitive' }, active: true, product: { active: true } },
          include: { product: true },
        });

    if (!variant) {
      throw new Error(
        `No active product matches "${raw.code ?? raw.variantId}". Use search_products to find the right size and pass its variantId or code.`
      );
    }
    if (variant.stock < quantity) {
      throw new Error(
        `Only ${variant.stock} of ${variant.product.name} ${variant.size ?? ''} (${variant.code}) left in stock — ${quantity} requested.`
      );
    }

    resolved.push({
      variantId: variant.id,
      quantity,
      name: `${variant.product.name}${variant.size ? ` ${variant.size}` : ''}`,
      code: variant.code,
      unitPrice: getEffectivePrice(variant),
    });
  }

  // Required add-ons are added by createOrder itself — bacteriostatic water,
  // syringes, swabs. Surfaced here so the operator sees them in the
  // confirmation rather than being surprised by extra lines afterwards.
  const parentIds = [
    ...new Set(
      (
        await prisma.productVariant.findMany({
          where: { id: { in: resolved.map((r) => r.variantId) } },
          select: { productId: true },
        })
      ).map((v: any) => v.productId)
    ),
  ];
  const requiredRelations = await prisma.productAddOn.findMany({
    where: { productId: { in: parentIds }, required: true, addOn: { active: true, product: { active: true } } },
    include: { addOn: { include: { product: true } } },
  });

  // Mirrors createOrder exactly: the larger requirement wins, quantities do not
  // sum, and they do not scale with how many units of the parent were ordered.
  const requiredMin = new Map<string, { quantity: number; name: string; code: string; unitPrice: number }>();
  for (const rel of requiredRelations) {
    const prev = requiredMin.get(rel.addOnId);
    requiredMin.set(rel.addOnId, {
      quantity: Math.max(prev?.quantity ?? 0, rel.quantity),
      name: `${rel.addOn.product.name}${rel.addOn.size ? ` ${rel.addOn.size}` : ''}`,
      code: rel.addOn.code,
      unitPrice: getEffectivePrice(rel.addOn),
    });
  }

  const autoAdded: typeof resolved = [];
  for (const [addOnId, req] of requiredMin) {
    const existing = resolved.find((r) => r.variantId === addOnId);
    if (existing) {
      existing.quantity = Math.max(existing.quantity, req.quantity);
    } else {
      autoAdded.push({ variantId: addOnId, quantity: req.quantity, name: req.name, code: req.code, unitPrice: req.unitPrice });
    }
  }

  const lines = [...resolved, ...autoAdded];
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  const shippingSetting = await prisma.setting.findUnique({ where: { key: 'shipping_fee' } });
  // Stored in RINGGIT in settings (e.g. "10.0"), unlike every other money value
  // in this system, which is cents. Converted the same way createOrder does.
  const shippingFee = Math.round(parseFloat(shippingSetting?.value ?? '0') * 100) || 0;

  return { lines, autoAdded, subtotal, shippingFee };
}

// The operator's words ("RM10 off", "15%") into the shared manual-discount
// input, or undefined when they gave none. Ringgit in, cents out — same
// conversion as every other money field the model sends.
function manualDiscountOf(input: { discountRm?: number; discountPercent?: number; discountNote?: string }) {
  if (input.discountRm === undefined && input.discountPercent === undefined) return undefined;
  if (input.discountRm !== undefined && input.discountPercent !== undefined) {
    throw new Error('Give the discount as ringgit (discountRm) or a percentage (discountPercent), not both.');
  }
  return {
    amount: input.discountRm === undefined ? undefined : toCents(input.discountRm),
    percent: input.discountPercent === undefined ? undefined : Math.round(input.discountPercent * 100) / 100,
    note: input.discountNote?.trim() || undefined,
  };
}

// The operator's changes ("make it 3 Reta", "take off the bac water") merged
// onto the order's current lines, into the full list adminSetOrderItems
// wants — and a human description of each change for the confirmation.
async function planOrderItems(fastify: any, prisma: any, input: any) {
  const found = await resolveOrder(prisma, input.orderRef);
  const order: any = await adminGetOrder(fastify, found.id);
  if (!Array.isArray(input.items) || !input.items.length) throw new Error('Pass at least one line to change.');

  const lines: { variantId: string; quantity: number; unitPrice: number; name: string }[] = order.items.map((i: any) => ({
    variantId: i.variantId,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    name: `${i.variant.product.name}${i.variant.size ? ` ${i.variant.size}` : ''} (${i.variant.code})`,
  }));
  const changes: string[] = [];

  for (const raw of input.items) {
    const quantity = Math.trunc(Number(raw.quantity));
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Quantity for "${raw.code ?? raw.variantId}" must be 0 or more.`);

    const variant = raw.variantId
      ? await prisma.productVariant.findFirst({ where: { id: raw.variantId }, include: { product: true } })
      : await prisma.productVariant.findFirst({
          where: { code: { equals: String(raw.code ?? ''), mode: 'insensitive' } },
          include: { product: true },
        });
    if (!variant) {
      throw new Error(`No product matches "${raw.code ?? raw.variantId}". Use search_products or get_order to find the right size.`);
    }
    const name = `${variant.product.name}${variant.size ? ` ${variant.size}` : ''} (${variant.code})`;
    const existing = lines.find((l) => l.variantId === variant.id);

    if (existing) {
      if (existing.quantity === quantity) continue;
      changes.push(quantity === 0 ? `remove ${existing.quantity}x ${name}` : `${name} ${existing.quantity} → ${quantity}`);
      existing.quantity = quantity;
    } else {
      if (quantity === 0) continue;
      if (!variant.active || !variant.product.active) throw new Error(`${name} is no longer sold and cannot be added.`);
      if (variant.stock < quantity) throw new Error(`Only ${variant.stock} of ${name} left in stock — ${quantity} requested.`);
      changes.push(`add ${quantity}x ${name} at ${rm(getEffectivePrice(variant))}`);
      lines.push({ variantId: variant.id, quantity, unitPrice: getEffectivePrice(variant), name });
    }
  }

  const kept = lines.filter((l) => l.quantity > 0);
  if (!kept.length) throw new Error('That would leave the order with no items — cancel the order instead.');
  return { order, lines, changes };
}

export const orderTools: AgentTool[] = [
  {
    name: 'create_order',
    description:
      'Create an order on a customer\'s behalf — for a sale agreed over WhatsApp or in person. Prices, stock and required add-ons are all taken from the database; never pass a price. Resolve products with search_products first and pass each variant\'s id or SKU code. This reduces stock immediately and, if an email is given and store emails are on, sends the customer a real order confirmation, so it always asks you to confirm first.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        customerName: { type: 'string' },
        phone: { type: 'string', description: 'Malaysian number in any format.' },
        email: { type: 'string', description: 'Optional for a WhatsApp order. REQUIRED for online payment.' },
        address: { type: 'string', description: 'Street address.' },
        city: { type: 'string' },
        state: { type: 'string' },
        postcode: { type: 'string' },
        items: {
          type: 'array',
          description: 'One entry per product size. Required add-ons are added automatically — do not list them yourself.',
          items: {
            type: 'object',
            properties: {
              variantId: { type: 'string', description: 'Preferred. From search_products.' },
              code: { type: 'string', description: 'SKU code, e.g. BP10. Use if you do not have the variantId.' },
              quantity: { type: 'number' },
            },
            required: ['quantity'],
          },
        },
        paymentMethod: {
          type: 'string',
          enum: ['WHATSAPP', 'ONLINE'],
          description:
            'WHATSAPP (default) = customer pays by manual bank transfer and someone marks it paid later. ONLINE = creates a real payment bill at the store\'s configured gateway and returns a link; needs an email address.',
        },
        discountCode: { type: 'string', description: 'A discount CODE the customer is redeeming. Not for a discount the operator is giving by hand — use discountRm / discountPercent for that.' },
        discountRm: { type: 'number', description: 'A discount the operator is giving, in RINGGIT off the order ("give him RM10 off"). Stacks with a code if one is also used.' },
        discountPercent: { type: 'number', description: 'A discount the operator is giving, as a percentage of the goods subtotal ("15% for the bulk order"). Use this OR discountRm, not both.' },
        discountNote: { type: 'string', description: 'Why the discount was given, for the books: "bulk order", "loyalty", "replaced leaked vial". Short.' },
        notes: { type: 'string' },
      },
      required: ['customerName', 'phone', 'address', 'city', 'state', 'postcode', 'items'],
    },
    summarize: async ({ fastify, prisma }, input) => {
      const { lines, autoAdded, subtotal, shippingFee } = await priceOrderPreview(prisma, input);

      let discountAmount = 0;
      let discountNote = '';
      if (input.discountCode) {
        try {
          // Read-only check — reserving the code happens inside createOrder.
          const { discountAmount: amt } = await validateDiscountCode(fastify, input.discountCode, subtotal);
          discountAmount = amt;
        } catch (err: any) {
          discountNote = ` (discount ${input.discountCode} will be REJECTED: ${err?.message ?? 'invalid'})`;
        }
      }

      const manual = manualDiscountOf(input);
      let manualText = '';
      if (manual) {
        const { amount, note } = resolveManualDiscount(manual, { subtotal, shippingFee });
        discountAmount = Math.min(discountAmount + amount, subtotal + shippingFee);
        manualText = ` − ${rm(amount)} off given by hand${note ? ` (${note})` : ''}`;
      }

      const total = Math.max(subtotal + shippingFee - discountAmount, 0);
      // "BILLPLZ" is accepted as an alias only because it is the stored enum
      // value; operators say "online".
      const isOnline = input.paymentMethod === 'ONLINE' || input.paymentMethod === 'BILLPLZ';
      const method = isOnline
        ? `online payment via ${gatewayLabel(await activeGatewayName(prisma))}`
        : 'WhatsApp / manual bank transfer';
      const itemText = lines.map((l) => `${l.quantity}x ${l.name} (${l.code}) ${rm(l.unitPrice * l.quantity)}`).join('; ');

      return [
        `create an order for ${input.customerName} (${input.phone}) — ${itemText}`,
        autoAdded.length ? `including required add-ons added automatically: ${autoAdded.map((a) => `${a.quantity}x ${a.name}`).join(', ')}` : '',
        `subtotal ${rm(subtotal)} + shipping ${rm(shippingFee)}${discountAmount && !manual ? ` − discount ${rm(discountAmount)}` : ''}${manualText} = *${rm(total)}*${discountNote}`,
        `paid by ${method}`,
        `This takes the stock immediately${input.email ? ` and emails an order confirmation to ${input.email}` : ' (no email given, so no confirmation will be sent)'}`,
      ]
        .filter(Boolean)
        .join('. ');
    },
    run: async ({ fastify, prisma }, input) => {
      // Re-price at execution time rather than trusting the summary: stock or a
      // sale could have moved between the confirmation and the yes.
      const { lines, autoAdded } = await priceOrderPreview(prisma, input);

      // Delegates to the real checkout controller — the same path a customer
      // goes through. That is what keeps the atomic stock decrement, the
      // discount reservation, required add-ons, the confirmation email queued
      // inside the same transaction, and the revenue capture all intact.
      const result: any = await createOrder(fastify, {
        customerName: input.customerName,
        phone: input.phone,
        email: input.email || undefined,
        address: input.address,
        city: input.city,
        state: input.state,
        postcode: input.postcode,
        // BILLPLZ is the stored enum for "paid online", whatever the gateway.
        paymentMethod: input.paymentMethod === 'ONLINE' || input.paymentMethod === 'BILLPLZ' ? 'BILLPLZ' : 'WHATSAPP',
        discountCode: input.discountCode || undefined,
        notes: input.notes || undefined,
        // Required add-ons are deliberately NOT passed — createOrder adds them
        // itself, and passing them too would be a second source of truth.
        items: lines
          .filter((l) => !autoAdded.some((a) => a.variantId === l.variantId))
          .map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
      }, { manualDiscount: manualDiscountOf(input) });

      const order = result.order;
      const gateway = await activeGatewayName(prisma);
      return {
        orderNumber: order.orderNumber,
        orderId: order.id,
        customer: order.customerName,
        phone: order.phone,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: paymentMethodLabel(order, gateway),
        subtotal: money(order.subtotal),
        shippingFee: money(order.shippingFee),
        discountAmount: money(order.discountAmount),
        discountNote: order.discountNote ?? null,
        total: money(order.total),
        addOnsAdded: autoAdded.map((a) => `${a.quantity}x ${a.name}`),
        paymentUrl: result.paymentUrl ?? null,
        note:
          order.paymentMethod === 'BILLPLZ'
            ? `${gatewayLabel(gateway)} bill created — send the customer the paymentUrl. The order stays UNPAID until they pay and the gateway confirms.`
            : 'Stock has been taken. The order stays UNPAID until someone confirms the transfer arrived and marks it paid.',
      };
    },
  },

  {
    name: 'list_orders',
    description:
      'List orders with filters. Use for "today\'s orders", "unpaid orders", "what has not shipped", etc. Returns summaries — call get_order for full detail on one.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'DELETED'],
        },
        paymentStatus: { type: 'string', enum: ['UNPAID', 'PAID', 'FAILED', 'REFUNDED'] },
        search: { type: 'string', description: 'Matches order number, customer name or phone.' },
        from: { type: 'string', description: 'Date as YYYY-MM-DD, "today", "yesterday" or "30d".' },
        to: { type: 'string', description: 'Date as YYYY-MM-DD.' },
        missingCosts: {
          type: 'boolean',
          description:
            'Only paid, live orders where at least one line has no cost entered yet — the ones whose profit and partner split are unknown. Use set_order_costs to fill them in.',
        },
        limit: { type: 'number' },
      },
    },
    run: async ({ prisma }, input) => {
      const where: any =
        input.status === 'DELETED' ? { deletedAt: { not: null } } : { deletedAt: null };
      if (input.status && input.status !== 'DELETED') where.status = input.status;
      if (input.paymentStatus) where.paymentStatus = input.paymentStatus;
      if (input.missingCosts) {
        // A cancelled or unpaid order has no profit to cost; a line with a
        // null unitCost is "not entered yet" (profit.ts treats 0 as a real
        // cost), so this is exactly the set the Profit Sharing tab reports as
        // unknown.
        where.paymentStatus = where.paymentStatus ?? 'PAID';
        where.status = where.status ?? { notIn: ['CANCELLED'] };
        where.items = { some: { unitCost: null } };
      }
      if (input.search) {
        where.OR = [
          { orderNumber: { contains: input.search, mode: 'insensitive' } },
          { customerName: { contains: input.search, mode: 'insensitive' } },
          { phone: { contains: input.search } },
        ];
      }
      const from = parseDate(input.from, false);
      const to = parseDate(input.to, true);
      if (from || to) where.createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

      const gateway = await activeGatewayName(prisma);
      const [orders, total, sum] = await Promise.all([
        prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take: clampLimit(input.limit) }),
        prisma.order.count({ where }),
        prisma.order.aggregate({ where, _sum: { total: true } }),
      ]);

      return {
        matched: total,
        showing: orders.length,
        truncated: total > orders.length,
        // Travels with the data, not just in the tool description. Both August
        // fabrication incidents began with a `list_orders` result in front of
        // the model and no items or address in it — and it wrote both anyway.
        // The description already warned about that and was read once, at
        // tool-choice time; this is in front of it while it drafts.
        _detail: summaryOnly('line items, address, costs, profit split or email status', 'get_order'),
        totalValue: money(sum._sum.total ?? 0),
        orders: orders.map((o) => orderSummary(o, gateway)),
      };
    },
  },

  {
    name: 'get_order',
    description:
      'Everything about one order: line items, costs entered so far, profit split, email delivery status, discount used. Accepts an order number, customer name, phone or id.',
    input_schema: {
      type: 'object',
      properties: { orderRef: { type: 'string' } },
      required: ['orderRef'],
    },
    run: async ({ fastify, prisma }, input) => {
      const found = await resolveOrder(prisma, input.orderRef);
      const o: any = await adminGetOrder(fastify, found.id);
      const itemsCosted = o.items.every((i: any) => i.unitCost != null);
      return {
        ...orderSummary(o, await activeGatewayName(prisma)),
        address: `${o.address}, ${o.postcode} ${o.city}, ${o.state}`,
        subtotal: money(o.subtotal),
        shippingFee: money(o.shippingFee),
        discountAmount: money(o.discountAmount),
        discountCode: o.discountCode?.code ?? null,
        discountNote: o.discountNote ?? null,
        notes: o.notes,
        items: o.items.map((i: any) => ({
          itemId: i.id,
          product: i.variant.product.name,
          code: i.variant.code,
          size: i.variant.size,
          quantity: i.quantity,
          unitPrice: money(i.unitPrice),
          lineTotal: money(i.unitPrice * i.quantity),
          unitCost: i.unitCost == null ? null : money(i.unitCost),
          // Whose price list the cost came from; null = keyed in by hand.
          supplier: i.supplier?.name ?? null,
        })),
        extraCosts: o.extraCosts.map((c: any) => ({ id: c.id, label: c.label, amount: money(c.amount) })),
        profitShares: o.profitShares.map((s: any) => ({
          name: s.name,
          sharePercent: s.shareBps / 100,
          capitalPutIn: money(s.capitalAmount),
        })),
        allItemsCosted: itemsCosted,
        emails: o.emails,
      };
    },
  },

  {
    name: 'update_order',
    description:
      'Change an order\'s status, payment status, tracking number or notes. Side effects are handled automatically: cancelling or failing an order restores its stock, marking it REFUNDED also triggers the Billplz refund where applicable, and marking it PAID queues the receipt email and records the revenue.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        orderRef: { type: 'string' },
        status: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED'] },
        paymentStatus: { type: 'string', enum: ['UNPAID', 'PAID', 'FAILED', 'REFUNDED'] },
        trackingNumber: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['orderRef'],
    },
    // Cancelling and refunding move stock and money. Everything else on this
    // tool (tracking number, notes, marking shipped) is routine and runs
    // straight through — gating those would make the agent tiresome for the
    // job it exists to do.
    destructive: false,
    run: async ({ fastify, prisma }, input) => {
      const order = await resolveOrder(prisma, input.orderRef);
      const body: any = {};
      for (const k of ['status', 'paymentStatus', 'trackingNumber', 'notes']) {
        if (input[k] !== undefined) body[k] = input[k];
      }
      if (!Object.keys(body).length) throw new Error('Nothing to update — pass at least one field.');

      const updated: any = await adminUpdateOrder(fastify, order.id, body);
      return {
        ...orderSummary(updated, await activeGatewayName(prisma)),
        changed: Object.keys(body),
        note:
          body.status === 'CANCELLED'
            ? 'Stock has been restored to inventory.'
            : body.paymentStatus === 'PAID'
              ? 'Receipt email queued and revenue recorded.'
              : body.paymentStatus === 'REFUNDED'
                ? 'Stock restored. If this was a ToyyibPay order, the actual refund must still be issued manually in the ToyyibPay dashboard.'
                : undefined,
      };
    },
  },

  {
    name: 'set_order_discount',
    description:
      'Give (or change, or remove) a discount on an EXISTING order by hand: RM off or a percentage of the goods subtotal, with the reason. Recomputes the order total, so the receipt and the books follow. Sets the order\'s one discount figure — it replaces any earlier discount on the order rather than adding to it. Amount 0 removes the discount. Refused on an order already paid online (record a partial refund instead) or refunded.',
    write: true,
    // Changes what the customer owes — worth a yes before it lands.
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        orderRef: { type: 'string' },
        discountRm: { type: 'number', description: 'Ringgit off the order. 0 removes the discount.' },
        discountPercent: { type: 'number', description: 'Percentage of the goods subtotal. Use this OR discountRm.' },
        discountNote: { type: 'string', description: 'Why: "bulk order", "loyalty", "replaced leaked vial".' },
      },
      required: ['orderRef'],
    },
    summarize: async ({ prisma }, input) => {
      const o = await resolveOrder(prisma, input.orderRef);
      const manual = manualDiscountOf(input);
      if (!manual) throw new Error('Pass discountRm or discountPercent.');
      const subtotal = goodsSubtotal(o);
      const { amount, note } = resolveManualDiscount(manual, { subtotal, shippingFee: o.shippingFee });
      const total = Math.max(subtotal + o.shippingFee - amount, 0);
      const was = o.discountAmount ? ` (replacing the ${rm(o.discountAmount)} discount already on it)` : '';
      return amount === 0
        ? `remove the discount from ${o.orderNumber} (${o.customerName}) — total goes ${rm(o.total)} → *${rm(total)}*`
        : `give ${rm(amount)} off ${o.orderNumber} (${o.customerName})${note ? ` for "${note}"` : ''}${was} — total goes ${rm(o.total)} → *${rm(total)}*`;
    },
    run: async ({ fastify, prisma }, input) => {
      const o = await resolveOrder(prisma, input.orderRef);
      const manual = manualDiscountOf(input);
      if (!manual) throw new Error('Pass discountRm or discountPercent.');
      const updated: any = await adminSetOrderDiscount(fastify, o.id, manual);
      return {
        ...orderSummary(updated, await activeGatewayName(prisma)),
        subtotal: money(updated.subtotal),
        shippingFee: money(updated.shippingFee),
        discountAmount: money(updated.discountAmount),
        discountNote: updated.discountNote ?? null,
        previousTotal: money(o.total),
        note: updated.paymentStatus === 'PAID'
          ? 'This order was already marked paid — make sure the new total is what was actually received.'
          : undefined,
      };
    },
  },

  {
    name: 'set_order_items',
    description:
      'Change WHAT an existing order is for: correct a quantity, remove a line, add a product. Use this when the customer changed their mind or the order was keyed in wrong — never "fix" a wrong quantity through set_order_costs. Stock moves by the difference, existing lines keep the price they were sold at, a new line is priced at today\'s price, and the total is recomputed (a percentage discount follows the new goods total; a fixed one stays). Lines you do not mention are left alone; quantity 0 removes a line. Refused on an order paid online, refunded, cancelled, or with a payment page open.',
    write: true,
    // Moves stock and changes what the customer owes.
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        orderRef: { type: 'string' },
        items: {
          type: 'array',
          description: 'Only the lines to change or add. Each is a product size (variantId from search_products/get_order, or its SKU code) with the quantity it should be FROM NOW ON — not the difference. 0 removes the line.',
          items: {
            type: 'object',
            properties: {
              variantId: { type: 'string' },
              code: { type: 'string', description: 'SKU code, e.g. BP10. Use if you do not have the variantId.' },
              quantity: { type: 'number', description: 'The new quantity for this line. 0 removes it.' },
            },
            required: ['quantity'],
          },
        },
      },
      required: ['orderRef', 'items'],
    },
    summarize: async ({ fastify, prisma }, input) => {
      const { order, lines, changes } = await planOrderItems(fastify, prisma, input);
      if (!changes.length) throw new Error('Nothing changes — every line already has that quantity.');
      const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
      const discount = carryDiscount(order, { subtotal, shippingFee: order.shippingFee });
      const total = Math.max(subtotal + order.shippingFee - discount, 0);
      const discountText =
        discount !== order.discountAmount ? `, discount ${rm(order.discountAmount)} → ${rm(discount)}` : '';
      return `change ${order.orderNumber} (${order.customerName}): ${changes.join(', ')} — goods ${rm(goodsSubtotal(order))} → ${rm(subtotal)}${discountText}, total ${rm(order.total)} → *${rm(total)}*. Stock moves to match`;
    },
    run: async ({ fastify, prisma }, input) => {
      const { order, lines, changes } = await planOrderItems(fastify, prisma, input);
      if (!changes.length) throw new Error('Nothing changes — every line already has that quantity.');
      const updated: any = await adminSetOrderItems(fastify, order.id, {
        items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
      });
      return {
        ...orderSummary(updated, await activeGatewayName(prisma)),
        changed: changes,
        items: updated.items.map((i: any) => ({
          product: i.variant.product.name,
          code: i.variant.code,
          size: i.variant.size,
          quantity: i.quantity,
          unitPrice: money(i.unitPrice),
          lineTotal: money(i.unitPrice * i.quantity),
        })),
        subtotal: money(updated.subtotal),
        shippingFee: money(updated.shippingFee),
        discountAmount: money(updated.discountAmount),
        previousTotal: money(order.total),
        note: [
          updated.paymentStatus === 'PAID' ? 'This order was already marked paid — make sure the new total is what was actually received.' : '',
          updated.email ? 'The customer has NOT been emailed about the change — use resend_order_email if they need the updated confirmation.' : '',
        ].filter(Boolean).join(' ') || undefined,
      };
    },
  },

  {
    name: 'set_order_costs',
    description:
      'Record what an order cost the business: a per-unit cost for each line, plus any extra costs (courier, fuel, packaging). Amounts in RINGGIT. On a line, name the supplier instead of a figure to take that supplier\'s price off the price list (list_suppliers) — the price is copied and the supplier recorded on the line. This replaces the whole cost set for the order, so send every line and every extra cost each time. Costs only — a wrong quantity is fixed with set_order_items, a discount with set_order_discount.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        orderRef: { type: 'string' },
        itemCosts: {
          type: 'array',
          description: 'One entry per order line. Get itemId values from get_order.',
          items: {
            type: 'object',
            properties: {
              itemId: { type: 'string' },
              unitCostRm: { type: 'number', description: 'Cost per unit in ringgit. Pass null to clear. Ignored when supplier is given.' },
              supplier: {
                type: 'string',
                description: 'Supplier name: cost this line at that supplier\'s list price for the SKU. Fails if they have no price for it.',
              },
            },
            required: ['itemId'],
          },
        },
        extraCosts: {
          type: 'array',
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, amountRm: { type: 'number' } },
            required: ['label', 'amountRm'],
          },
        },
      },
      required: ['orderRef'],
    },
    run: async ({ fastify, prisma }, input) => {
      const order = await resolveOrder(prisma, input.orderRef);
      const existing: any = await adminGetOrder(fastify, order.id);

      // The controller replaces the full set, so anything omitted here would
      // be silently wiped. Default to what is already saved — supplier
      // included, so re-costing one line does not strip the others' provenance.
      const options = await getSupplierOptions(fastify, existing.items.map((i: any) => i.variantId));
      const itemCosts = [];
      for (const c of input.itemCosts?.length
        ? input.itemCosts
        : existing.items.map((i: any) => ({
            itemId: i.id,
            unitCostRm: i.unitCost == null ? null : i.unitCost / 100,
            supplierId: i.supplierId,
          }))) {
        const line = existing.items.find((i: any) => i.id === c.itemId);
        if (!line) throw new Error(`Line ${c.itemId} is not on ${existing.orderNumber}. Get itemId values from get_order.`);
        if (c.supplier) {
          const supplier = await resolveSupplier(fastify, c.supplier);
          const priced = (options[line.variantId] ?? []).find((o: any) => o.supplierId === supplier.id);
          const name = `${line.variant.product.name}${line.variant.size ? ` ${line.variant.size}` : ''} (${line.variant.code})`;
          if (!priced) {
            const others = (options[line.variantId] ?? []).map((o: any) => `${o.name} ${rm(o.cost)}`).join(', ');
            throw new Error(
              `${supplier.name} has no price for ${name}.${others ? ` Priced by: ${others}.` : ' Nobody has priced it yet.'} Add one with set_supplier_cost or give unitCostRm instead.`
            );
          }
          itemCosts.push({ itemId: c.itemId, unitCost: priced.cost, supplierId: supplier.id });
        } else {
          const unitCost = c.unitCostRm == null ? null : toCents(c.unitCostRm);
          // A hand-typed figure on a line that was costed from the list keeps
          // the supplier only while the figure still matches their price.
          const keep = c.supplierId ?? (line.supplierId && line.unitCost === unitCost ? line.supplierId : null);
          itemCosts.push({ itemId: c.itemId, unitCost, supplierId: unitCost === null ? null : keep });
        }
      }

      const extraCosts = (input.extraCosts ?? existing.extraCosts.map((c: any) => ({ label: c.label, amountRm: c.amount / 100 }))).map(
        (c: any) => ({ label: c.label, amount: toCents(c.amountRm) })
      );

      await adminUpdateOrderCosts(fastify, order.id, { itemCosts, extraCosts });
      const after: any = await adminGetOrder(fastify, order.id);
      const goods = after.items.reduce((s: number, i: any) => s + (i.unitCost ?? 0) * i.quantity, 0);
      const extras = after.extraCosts.reduce((s: number, c: any) => s + c.amount, 0);
      const allCosted = after.items.every((i: any) => i.unitCost != null);

      return {
        orderNumber: after.orderNumber,
        lines: after.items.map((i: any) => ({
          item: `${i.variant.product.name}${i.variant.size ? ` ${i.variant.size}` : ''}`,
          unitCost: money(i.unitCost),
          supplier: i.supplier?.name ?? null,
        })),
        goodsCost: money(goods),
        extraCosts: money(extras),
        totalCost: money(goods + extras),
        revenue: money(after.total),
        netProfit: allCosted ? money(after.total - goods - extras) : null,
        allItemsCosted: allCosted,
        note: allCosted ? undefined : 'Some lines still have no cost — profit stays unknown until every line is priced.',
      };
    },
  },

  {
    name: 'set_order_profit_shares',
    description:
      'Set how one order\'s profit is split between people, and who paid for the order\'s costs. Percentages must total 100. capitalRm is money that person put in to cover the costs before the customer paid — it is returned to them ON TOP of their profit cut, never deducted. Across a split it should normally add up to the order\'s total cost.',
    write: true,
    input_schema: {
      type: 'object',
      properties: {
        orderRef: { type: 'string' },
        shares: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              percent: { type: 'number', description: 'Share of profit, e.g. 30 for 30%. All shares must total 100.' },
              capitalRm: { type: 'number', description: "Ringgit this person put up to cover this order's costs. Paid back to them on top of their profit share." },
            },
            required: ['name', 'percent'],
          },
        },
      },
      required: ['orderRef', 'shares'],
    },
    run: async ({ fastify, prisma }, input) => {
      const order = await resolveOrder(prisma, input.orderRef);
      const shares = input.shares.map((s: any) => ({
        name: String(s.name).trim(),
        // Basis points, so a three-way split lands exactly on 100%.
        shareBps: Math.round(s.percent * 100),
        capitalAmount: s.capitalRm ? toCents(s.capitalRm) : 0,
      }));
      const totalBps = shares.reduce((a: number, s: any) => a + s.shareBps, 0);
      if (totalBps !== 10_000) {
        throw new Error(
          `Shares total ${(totalBps / 100).toFixed(2)}%, not 100%. Adjust before saving. (For an even three-way split use 33.33 / 33.33 / 33.34.)`
        );
      }
      await adminUpdateOrderProfitShares(fastify, order.id, { shares });
      return {
        orderNumber: order.orderNumber,
        shares: shares.map((s: any) => ({
          name: s.name,
          percent: s.shareBps / 100,
          capitalPutIn: money(s.capitalAmount),
        })),
      };
    },
  },

  {
    name: 'resend_order_email',
    description:
      'Queue an order confirmation or payment receipt to the customer. This sends REAL mail to a REAL customer, so it asks for confirmation first. Note it does nothing visible if the emails_enabled setting is off.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: {
        orderRef: { type: 'string' },
        type: { type: 'string', enum: ['ORDER_CONFIRMATION', 'PAYMENT_RECEIPT'] },
      },
      required: ['orderRef', 'type'],
    },
    summarize: async ({ prisma }, input) => {
      const o = await resolveOrder(prisma, input.orderRef);
      return `send a ${input.type === 'PAYMENT_RECEIPT' ? 'payment receipt' : 'order confirmation'} email to ${
        o.email ?? '(no email on this order)'
      } for order ${o.orderNumber}`;
    },
    run: async ({ fastify, prisma }, input) => {
      const order = await resolveOrder(prisma, input.orderRef);
      const row: any = await adminResendOrderEmail(fastify, order.id, { type: input.type });
      const enabled = await prisma.setting.findUnique({ where: { key: 'emails_enabled' } });
      return {
        orderNumber: order.orderNumber,
        to: row.toEmail,
        type: row.type,
        status: row.status,
        warning:
          enabled?.value === 'true'
            ? undefined
            : 'Queued, but the emails_enabled setting is OFF so nothing will actually send until it is turned on.',
      };
    },
  },

  {
    name: 'delete_order',
    description:
      'Move an order into the Deleted view. This is a soft delete — the row is kept and can be restored — but the order disappears from every normal list, so it asks for confirmation.',
    write: true,
    destructive: true,
    input_schema: {
      type: 'object',
      properties: { orderRef: { type: 'string' } },
      required: ['orderRef'],
    },
    summarize: async ({ prisma }, input) => {
      const o = await resolveOrder(prisma, input.orderRef);
      return `delete order ${o.orderNumber} (${o.customerName}, ${rm(o.total)}, ${o.status}). It can be restored afterwards, and stock is not affected.`;
    },
    run: async ({ fastify, prisma }, input) => {
      const order = await resolveOrder(prisma, input.orderRef);
      await adminDeleteOrder(fastify, order.id);
      return { orderNumber: order.orderNumber, deleted: true, note: 'Soft delete — use restore_order to undo.' };
    },
  },

  {
    name: 'restore_order',
    description: 'Bring a soft-deleted order back into the normal lists.',
    write: true,
    input_schema: {
      type: 'object',
      properties: { orderRef: { type: 'string' } },
      required: ['orderRef'],
    },
    run: async ({ fastify, prisma }, input) => {
      const order = await resolveOrder(prisma, input.orderRef);
      await adminRestoreOrder(fastify, order.id);
      return { orderNumber: order.orderNumber, restored: true };
    },
  },
];
