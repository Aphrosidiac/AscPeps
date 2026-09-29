import type { FastifyInstance } from 'fastify';
import { sendWhatsAppMessage } from './whatsapp-send.js';
import { costOrder, allocate } from './profit.js';
import { computeFinance } from './finance.js';
import { RESTOCK_BELOW } from './restock.js';
import { getVariantDisplayName } from './product-addons.js';
import { loadFinanceInput } from '../modules/admin/admin-finance.controller.js';
import { malaysiaDay, readHour, readSetting, writeSetting, SETTING_KEYS } from '../modules/ai-agent/schedule.js';

/**
 * The month-end wrap: one WhatsApp message on the 1st covering the month that
 * just ended — revenue, profit, what each partner earned from it, the orders
 * still hanging, and the stock position. Asked for by the operators on
 * 2026-09-25 ("like the morning brief, but for the month").
 *
 * Written by code, not the model, for the same reason as the order notice:
 * it is the number partners settle up on. A model reformatting RM 2,989.00
 * into RM 2,898.00 once is a dispute; the figures here come from the same
 * costOrder/allocate the Analytics and Finance pages use, so all three agree.
 * The assistant reaches it through `month_end_report` and is told to pass the
 * text on as is.
 *
 * A month is a Malaysian calendar month, and an order belongs to the month it
 * was PLACED in — the Analytics page's rule. "Hanging" orders and stock are
 * the position when the wrap is written, not at midnight on the last day:
 * what needs chasing is what is open now.
 */

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000; // Malaysia has no DST
const DEFAULT_HOUR = 9;
const LIST_MAX = 8;

export type MonthKey = string; // YYYY-MM

export function monthBounds(month: MonthKey): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new Error(`Month must be YYYY-MM, got ${JSON.stringify(month)}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { start: new Date(Date.UTC(y, mo, 1) - MYT_OFFSET_MS), end: new Date(Date.UTC(y, mo + 1, 1) - MYT_OFFSET_MS) };
}

export function shiftMonth(month: MonthKey, by: number): MonthKey {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function currentMonth(now = new Date()): MonthKey {
  return malaysiaDay(now).day.slice(0, 7);
}

function monthLabel(month: MonthKey): string {
  const { start } = monthBounds(month);
  return new Intl.DateTimeFormat('en-MY', { timeZone: 'Asia/Kuala_Lumpur', month: 'long', year: 'numeric' }).format(start);
}

export interface MonthEndReport {
  month: MonthKey;
  label: string;
  /** The month is not over yet — the figures are month to date. */
  partial: boolean;
  orders: { placed: number; paid: number; unpaid: number; failed: number; cancelled: number };
  revenue: number;
  refunded: number;
  avgOrder: number;
  previous: { month: MonthKey; label: string; revenue: number };
  costedOrders: number;
  uncosted: { orderNumber: string; total: number }[];
  itemCost: number;
  extraCost: number;
  gatewayFees: number;
  /** costed revenue − item, extra and gateway costs. Uncosted orders are in none of it. */
  grossProfit: number;
  operatingSpend: number;
  inventoryBought: number;
  netProfit: number;
  partners: { name: string; earned: number; capitalFronted: number; owedToDate: number }[];
  /** Profit on costed orders nobody was given a share of. */
  unsplitProfit: number;
  hanging: {
    unpaid: { orderNumber: string; customer: string; total: number; days: number }[];
    toShip: { orderNumber: string; customer: string; total: number; days: number }[];
  };
  /** Products only — add-on supplies are counted apart so they cannot top the list. */
  unitsSold: number;
  suppliesSold: number;
  topSellers: { name: string; units: number }[];
  stock: { restockBelow: number; restock: { name: string; stock: number }[]; outOfStock: number; unitsOnHand: number };
}

async function monthRevenue(fastify: FastifyInstance, month: MonthKey): Promise<number> {
  const { start, end } = monthBounds(month);
  const orders = await fastify.prisma.order.findMany({
    where: { deletedAt: null, createdAt: { gte: start, lt: end }, paymentStatus: { in: ['PAID', 'REFUNDED'] } },
    select: { total: true, refundedAmount: true },
  });
  return orders.reduce((s, o) => s + o.total - (o.refundedAmount ?? 0), 0);
}

export async function computeMonthEnd(fastify: FastifyInstance, month: MonthKey, now = new Date()): Promise<MonthEndReport> {
  const { start, end } = monthBounds(month);
  const prisma = fastify.prisma;
  const previousMonth = shiftMonth(month, -1);

  const [orders, expenses, openOrders, variants, financeInput, previousRevenue] = await Promise.all([
    prisma.order.findMany({
      where: { deletedAt: null, createdAt: { gte: start, lt: end } },
      select: {
        orderNumber: true,
        total: true,
        status: true,
        paymentStatus: true,
        gatewayFee: true,
        refundedAmount: true,
        stockRestored: true,
        createdAt: true,
        items: {
          select: {
            quantity: true,
            unitCost: true,
            // Offered as an add-on to something = a supply (swabs, syringes, bac water).
            variant: { select: { size: true, product: { select: { name: true } }, _count: { select: { offeredAsAddOnFor: true } } } },
          },
        },
        extraCosts: { select: { amount: true } },
        profitShares: { select: { partnerId: true, name: true, shareBps: true, capitalAmount: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.companyExpense.findMany({ where: { occurredAt: { gte: start, lt: end } }, select: { amount: true, kind: true } }),
    // Open now, whatever month they were placed in.
    prisma.order.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ['CANCELLED', 'SHIPPED', 'DELIVERED'] },
        paymentStatus: { in: ['UNPAID', 'PAID'] },
      },
      select: { orderNumber: true, customerName: true, total: true, paymentStatus: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.productVariant.findMany({
      where: { active: true, product: { active: true } },
      select: { code: true, size: true, stock: true, product: { select: { name: true } } },
      orderBy: { stock: 'asc' },
    }),
    loadFinanceInput(fastify),
    monthRevenue(fastify, previousMonth),
  ]);

  const counts = { placed: orders.length, paid: 0, unpaid: 0, failed: 0, cancelled: 0 };
  let revenue = 0;
  let refunded = 0;
  let costedOrders = 0;
  let itemCost = 0;
  let extraCost = 0;
  let gatewayFees = 0;
  let grossProfit = 0;
  let unsplitProfit = 0;
  let unitsSold = 0;
  let suppliesSold = 0;
  const uncosted: MonthEndReport['uncosted'] = [];
  const earned = new Map<string, number>();
  const capital = new Map<string, number>();
  const sold = new Map<string, number>();

  for (const o of orders) {
    const moneyIn = o.paymentStatus === 'PAID' || o.paymentStatus === 'REFUNDED';
    if (o.paymentStatus === 'FAILED') counts.failed++;
    else if (o.status === 'CANCELLED') counts.cancelled++;
    else if (o.paymentStatus === 'UNPAID') counts.unpaid++;
    if (!moneyIn) continue;
    counts.paid++;

    const c = costOrder(o);
    revenue += c.revenue;
    refunded += c.refunded;
    // Capital is typed in because it happened — owed back whether or not the
    // order is costed yet (finance.ts, same rule).
    for (const s of o.profitShares) if (s.partnerId && s.capitalAmount) capital.set(s.partnerId, (capital.get(s.partnerId) ?? 0) + s.capitalAmount);

    if (o.paymentStatus === 'PAID') {
      for (const i of o.items) {
        if (i.variant._count.offeredAsAddOnFor > 0) {
          suppliesSold += i.quantity;
          continue;
        }
        const name = getVariantDisplayName(i.variant.product, i.variant);
        sold.set(name, (sold.get(name) ?? 0) + i.quantity);
        unitsSold += i.quantity;
      }
    }

    if (c.profit === null) {
      uncosted.push({ orderNumber: o.orderNumber, total: o.total });
      continue;
    }
    costedOrders++;
    itemCost += c.itemCost;
    extraCost += c.extraCost;
    gatewayFees += c.gatewayFee;
    grossProfit += c.profit;

    const shares = o.profitShares.filter((s) => s.partnerId);
    if (!shares.length) {
      unsplitProfit += c.profit;
      continue;
    }
    const amounts = allocate(c.profit, shares.map((s) => s.shareBps));
    shares.forEach((s, i) => earned.set(s.partnerId!, (earned.get(s.partnerId!) ?? 0) + amounts[i]));
  }

  let operatingSpend = 0;
  let inventoryBought = 0;
  for (const e of expenses) {
    if (e.kind === 'INVENTORY') inventoryBought += e.amount;
    else operatingSpend += e.amount;
  }

  // Lifetime balances from the Finance page's own maths: what the company
  // owes each partner right now, after payouts and advances.
  const finance = computeFinance(financeInput);
  const partners = finance.partners
    .filter((p) => earned.has(p.partnerId) || capital.has(p.partnerId) || (p.active && p.owed !== 0))
    .map((p) => ({ name: p.name, earned: earned.get(p.partnerId) ?? 0, capitalFronted: capital.get(p.partnerId) ?? 0, owedToDate: p.owed }))
    .sort((a, b) => b.earned - a.earned);

  const days = (d: Date) => Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  const open = (o: (typeof openOrders)[number]) => ({ orderNumber: o.orderNumber, customer: o.customerName, total: o.total, days: days(o.createdAt) });

  return {
    month,
    label: monthLabel(month),
    partial: now < end,
    orders: counts,
    revenue,
    refunded,
    avgOrder: counts.paid ? Math.round(revenue / counts.paid) : 0,
    previous: { month: previousMonth, label: monthLabel(previousMonth), revenue: previousRevenue },
    costedOrders,
    uncosted,
    itemCost,
    extraCost,
    gatewayFees,
    grossProfit,
    operatingSpend,
    inventoryBought,
    netProfit: grossProfit - operatingSpend,
    partners,
    unsplitProfit,
    hanging: {
      unpaid: openOrders.filter((o) => o.paymentStatus === 'UNPAID').map(open),
      toShip: openOrders.filter((o) => o.paymentStatus === 'PAID').map(open),
    },
    unitsSold,
    suppliesSold,
    topSellers: [...sold.entries()].map(([name, units]) => ({ name, units })).sort((a, b) => b.units - a.units).slice(0, 5),
    stock: {
      restockBelow: RESTOCK_BELOW,
      restock: restockList(variants),
      outOfStock: variants.filter((v) => v.stock <= 0).length,
      unitsOnHand: variants.reduce((s, v) => s + Math.max(0, v.stock), 0),
    },
  };
}

// Two variants can share a display name (same product and size, different
// SKU); the code is added only then, so the list stays readable.
function restockList(variants: { code: string; size: string | null; stock: number; product: { name: string } }[]) {
  const low = variants.filter((v) => v.stock < RESTOCK_BELOW).map((v) => ({ name: getVariantDisplayName(v.product, v), code: v.code, stock: v.stock }));
  const seen = new Map<string, number>();
  for (const v of low) seen.set(v.name, (seen.get(v.name) ?? 0) + 1);
  return low.map((v) => ({ name: (seen.get(v.name) ?? 0) > 1 ? `${v.name} (${v.code})` : v.name, stock: v.stock }));
}

// RM 1,234.50 — grouped, unlike tool-kit's rm(), because a month's figures
// run to four and five digits and WhatsApp is read on a phone.
function rm(cents: number): string {
  const sign = cents < 0 ? '−' : '';
  return `${sign}RM ${(Math.abs(cents) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function listed<T>(items: T[], line: (t: T) => string, max = LIST_MAX): string[] {
  const shown = items.slice(0, max).map((t) => `• ${line(t)}`);
  if (items.length > max) shown.push(`• …and ${items.length - max} more`);
  return shown;
}

export function monthEndText(r: MonthEndReport): string {
  const out: string[] = [];
  out.push(`📊 *${r.label} ${r.partial ? 'so far' : 'wrap'}*`);

  out.push('', '*Sales*');
  let vs = '';
  if (r.previous.revenue > 0) {
    const pct = Math.round(((r.revenue - r.previous.revenue) / r.previous.revenue) * 100);
    vs = ` · ${r.previous.label.split(' ')[0]} ${rm(r.previous.revenue)} (${pct >= 0 ? '+' : ''}${pct}%)`;
  }
  out.push(`Revenue *${rm(r.revenue)}* from ${r.orders.paid} paid order${r.orders.paid === 1 ? '' : 's'}${vs}`);
  out.push(`Avg order ${rm(r.avgOrder)}${r.refunded ? ` · refunded ${rm(r.refunded)}` : ''}`);
  const other = [r.orders.unpaid && `${r.orders.unpaid} unpaid`, r.orders.failed && `${r.orders.failed} failed`, r.orders.cancelled && `${r.orders.cancelled} cancelled`].filter(Boolean);
  out.push(`${r.orders.placed} placed${other.length ? `: ${other.join(', ')}` : ''}`);

  // Stock goes before any section that names an order: the grounding guard
  // attributes a product name to the nearest order number above it, so a
  // best seller listed under the hanging orders read as cross-record bleed.
  out.push('', '*Stock*');
  if (r.unitsSold || r.suppliesSold) {
    out.push(`Sold ${r.unitsSold} units${r.suppliesSold ? ` (+ ${r.suppliesSold} supplies)` : ''}`);
    if (r.topSellers.length) out.push(`Top: ${r.topSellers.map((t) => `${t.name} ×${t.units}`).join(', ')}`);
  }
  if (r.stock.restock.length) {
    out.push(`Restock — under ${r.stock.restockBelow} units (${r.stock.restock.length}):`);
    out.push(...listed(r.stock.restock, (v) => `${v.name}: ${v.stock <= 0 ? 'sold out' : v.stock}`, 30));
  } else {
    out.push(`Nothing under ${r.stock.restockBelow} units.`);
  }
  out.push(`${r.stock.unitsOnHand} units on hand`);

  out.push('', `*Profit*${r.uncosted.length ? ` (${r.costedOrders} of ${r.orders.paid} orders costed)` : ''}`);
  const costs = r.itemCost + r.extraCost + r.gatewayFees;
  if (r.costedOrders) out.push(`Costs ${rm(costs)} → gross profit *${rm(r.grossProfit)}*`);
  else if (r.orders.paid) out.push('No paid order is costed yet, so there is no profit figure.');
  if (r.operatingSpend) out.push(`Company spending ${rm(r.operatingSpend)} → net *${rm(r.netProfit)}*`);
  if (r.inventoryBought) out.push(`Stock bought ${rm(r.inventoryBought)} (counted when it sells)`);
  if (r.uncosted.length) {
    out.push(`⚠️ Not costed yet — profit leaves these out until the unit costs are in:`);
    out.push(...listed(r.uncosted, (o) => `${o.orderNumber} ${rm(o.total)}`));
  }

  out.push('', '*Partner earnings*');
  if (!r.partners.length) out.push('Nothing split yet this month.');
  for (const p of r.partners) {
    out.push(`${p.name}: *${rm(p.earned)}*${p.capitalFronted ? ` · fronted ${rm(p.capitalFronted)} of costs` : ''}`);
    out.push(`  owed to date ${rm(p.owedToDate)}`);
  }
  if (r.unsplitProfit) out.push(`${rm(r.unsplitProfit)} of profit is on orders with no split set`);

  out.push('', '*Hanging orders*');
  if (!r.hanging.unpaid.length && !r.hanging.toShip.length) out.push('None — everything is paid and shipped.');
  if (r.hanging.unpaid.length) {
    out.push(`Unpaid (${r.hanging.unpaid.length}):`);
    out.push(...listed(r.hanging.unpaid, (o) => `${o.orderNumber} ${rm(o.total)} · ${o.customer} · ${o.days}d`));
  }
  if (r.hanging.toShip.length) {
    out.push(`Paid, not shipped (${r.hanging.toShip.length}):`);
    out.push(...listed(r.hanging.toShip, (o) => `${o.orderNumber} ${rm(o.total)} · ${o.customer} · ${o.days}d`));
  }

  return out.join('\n');
}

// ── Delivery ──────────────────────────────────────────────────────────────

export async function monthEndRecipients(fastify: FastifyInstance) {
  const [operators, groups] = await Promise.all([
    fastify.prisma.whatsAppOperator.findMany({ where: { active: true, monthEnd: true }, select: { phone: true, name: true } }),
    fastify.prisma.whatsAppGroup.findMany({ where: { active: true, monthEnd: true }, select: { groupJid: true, subject: true } }),
  ]);
  return [...operators.map((o) => ({ to: { phone: o.phone }, name: o.name })), ...groups.map((g) => ({ to: { jid: g.groupJid }, name: `group ${g.subject}` }))];
}

export async function sendMonthEnd(fastify: FastifyInstance, month: MonthKey): Promise<{ sent: number; recipients: number; text: string }> {
  const text = monthEndText(await computeMonthEnd(fastify, month));
  const targets = await monthEndRecipients(fastify);
  let sent = 0;
  for (const t of targets) {
    try {
      await sendWhatsAppMessage(t.to, text);
      sent++;
    } catch (err) {
      fastify.log.error({ err, to: t.name }, 'month-end wrap could not be sent');
    }
  }
  fastify.log.info({ month, sent, recipients: targets.length }, 'month-end wrap');
  return { sent, recipients: targets.length, text };
}

/**
 * On the 1st, after the configured hour, the month just ended — once. The
 * 2nd and 3rd are a catch-up window for a server that was down on the 1st;
 * after that a missed month stays missed rather than arriving mid-month, and
 * switching the routine on mid-month does not fire last month's wrap.
 */
/** Which month's wrap is due at `now`, or null. Pure, so the timing can be tested without a send. */
export function monthEndDue(now: Date, atHour: number, lastSent: string | null): MonthKey | null {
  const { day, hour } = malaysiaDay(now);
  const dom = Number(day.slice(8, 10));
  if (dom > 3) return null;
  if (dom === 1 && hour < atHour) return null;
  const month = shiftMonth(day.slice(0, 7), -1);
  return lastSent === month ? null : month;
}

export async function maybeMonthEnd(fastify: FastifyInstance, now = new Date()): Promise<boolean> {
  if ((await readSetting(fastify, SETTING_KEYS.monthEnd)) !== 'true') return false;
  const at = await readHour(fastify, SETTING_KEYS.monthEndHour, DEFAULT_HOUR);
  const month = monthEndDue(now, at, await readSetting(fastify, SETTING_KEYS.monthEndLast));
  if (!month) return false;
  await writeSetting(fastify, SETTING_KEYS.monthEndLast, month);
  await sendMonthEnd(fastify, month);
  return true;
}
