import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getVariantDisplayName } from '../../utils/product-addons.js';
import { getEffectivePrice } from '../../utils/product-pricing.js';
import {
  DEFAULT_STAGES, batchLabel, groupBuyPhase, itemMinQty, joinedCount, kitPriceProblem, parseStages, type GroupBuyStage,
} from '../../utils/group-buy.js';
import { createSignup } from '../../utils/group-buy-signup.js';
import { enqueueStageNotices, renderNotice } from '../../utils/group-buy-notices.js';
import { normalizePhone } from '../../utils/phone.js';

/**
 * Admin → Group Buys. One batch carries everything needed to run it: window,
 * products and tier prices, order rules, the promotion (banner, popup, home
 * section), the "joined" counter, the sign-up reward and the customer
 * timeline. Batch orders are ordinary orders (Orders shows them too); the
 * batch page adds the views a batch needs: who signed up, who bought, and
 * how many of each vial to order from the supplier.
 */

const LIVE_ORDER = { deletedAt: null, status: { not: 'CANCELLED' as const } };

async function batchStats(fastify: FastifyInstance, ids: string[]) {
  if (ids.length === 0) return new Map<string, { orders: number; paidOrders: number; unpaidOrders: number; revenue: number; signups: number; buyers: number }>();
  const [orders, signups] = await Promise.all([
    fastify.prisma.order.findMany({
      where: { groupBuyId: { in: ids }, ...LIVE_ORDER },
      select: { groupBuyId: true, paymentStatus: true, total: true, refundedAmount: true, email: true, phone: true },
    }),
    fastify.prisma.groupBuySignup.groupBy({ by: ['groupBuyId'], _count: true, where: { groupBuyId: { in: ids } } }),
  ]);
  const out = new Map<string, { orders: number; paidOrders: number; unpaidOrders: number; revenue: number; signups: number; buyers: number }>();
  for (const id of ids) {
    const mine = orders.filter((o) => o.groupBuyId === id);
    const paid = mine.filter((o) => o.paymentStatus === 'PAID');
    out.set(id, {
      orders: mine.length,
      paidOrders: paid.length,
      unpaidOrders: mine.filter((o) => o.paymentStatus === 'UNPAID').length,
      revenue: paid.reduce((s, o) => s + o.total - o.refundedAmount, 0),
      signups: signups.find((s) => s.groupBuyId === id)?._count ?? 0,
      buyers: new Set(paid.map((o) => (o.email ?? o.phone).toLowerCase())).size,
    });
  }
  return out;
}

export async function adminListGroupBuys(fastify: FastifyInstance) {
  const rows = await fastify.prisma.groupBuy.findMany({
    orderBy: { number: 'desc' },
    include: { _count: { select: { items: true } } },
  });
  const stats = await batchStats(fastify, rows.map((r) => r.id));
  return rows.map((gb) => ({
    id: gb.id,
    number: gb.number,
    label: batchLabel(gb.number),
    slug: gb.slug,
    title: gb.title,
    published: gb.published,
    phase: groupBuyPhase(gb),
    opensAt: gb.opensAt,
    closesAt: gb.closesAt,
    stageKey: gb.stageKey,
    stageLabel: parseStages(gb.stages).find((s) => s.key === gb.stageKey)?.label ?? gb.stageKey,
    itemCount: gb._count.items,
    promo: { banner: gb.bannerEnabled, popup: gb.popupEnabled, home: gb.homeEnabled, reward: gb.rewardEnabled },
    ...stats.get(gb.id)!,
  }));
}

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'batch';
}

async function nextNumber(fastify: FastifyInstance): Promise<number> {
  const top = await fastify.prisma.groupBuy.aggregate({ _max: { number: true } });
  return (top._max.number ?? 0) + 1;
}

async function uniqueSlug(fastify: FastifyInstance, base: string, exceptId?: string): Promise<string> {
  let slug = base;
  for (let i = 2; ; i++) {
    const hit = await fastify.prisma.groupBuy.findUnique({ where: { slug }, select: { id: true } });
    if (!hit || hit.id === exceptId) return slug;
    slug = `${base}-${i}`;
  }
}

const createSchema = z.object({ title: z.string().trim().min(1).max(120).optional() });

export async function adminCreateGroupBuy(fastify: FastifyInstance, body: unknown) {
  const { title } = createSchema.parse(body ?? {});
  for (let attempt = 0; attempt < 3; attempt++) {
    const number = await nextNumber(fastify);
    const label = batchLabel(number);
    try {
      const now = new Date();
      const gb = await fastify.prisma.groupBuy.create({
        data: {
          number,
          title: title || `Group Buy — ${label}`,
          slug: await uniqueSlug(fastify, `batch-${String(number).padStart(2, '0')}`),
          opensAt: now,
          closesAt: new Date(now.getTime() + 7 * 24 * 3600 * 1000),
          stages: DEFAULT_STAGES as unknown as object,
          bannerText: `${label} is open — wholesale prices until it closes.`,
          popupTitle: `${label} is open`,
          popupBody: 'Wholesale tier pricing on a set list of products, for a limited time.',
          homeTitle: `Group Buy — ${label}`,
        },
      });
      return gb;
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err;
    }
  }
  throw { statusCode: 409, message: 'Could not number the new batch — try again.' };
}

export async function adminGetGroupBuy(fastify: FastifyInstance, id: string) {
  const gb = await fastify.prisma.groupBuy.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
        include: { tiers: { orderBy: { minQty: 'asc' } }, variant: { include: { product: { select: { name: true, slug: true, active: true } } } } },
      },
    },
  });
  if (!gb) throw { statusCode: 404, message: 'Group Buy not found' };
  const stats = (await batchStats(fastify, [gb.id])).get(gb.id)!;
  const now = new Date();
  return {
    ...gb,
    label: batchLabel(gb.number),
    phase: groupBuyPhase(gb, now),
    stages: parseStages(gb.stages),
    joinedShown: joinedCount(gb, stats.signups),
    stats,
    items: gb.items.map((it) => ({
      id: it.id,
      variantId: it.variantId,
      sortOrder: it.sortOrder,
      sellUnit: it.sellUnit,
      packSize: it.packSize,
      unitLabel: it.unitLabel,
      minQty: it.minQty,
      maxQty: it.maxQty,
      minAmount: it.minAmount,
      note: it.note,
      active: it.active,
      tiers: it.tiers.map((t) => ({ minQty: t.minQty, price: t.price })),
      variant: {
        name: getVariantDisplayName(it.variant.product, it.variant),
        code: it.variant.code,
        size: it.variant.size,
        imageUrl: it.variant.imageUrl,
        active: it.variant.active && it.variant.product.active,
        storePrice: getEffectivePrice(it.variant, now),
      },
    })),
  };
}

const dateish = z.string().datetime({ offset: true }).nullable();
const sen = z.number().int().min(0);
const text = (max: number) => z.string().max(max).nullable();

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(60),
  tagline: text(200),
  description: text(10000),
  heroImageUrl: text(500),
  published: z.boolean(),
  opensAt: z.string().datetime({ offset: true }),
  closesAt: z.string().datetime({ offset: true }),
  shipEstimate: text(120),
  minOrderAmount: sen.nullable(),
  maxUnitsPerOrder: z.number().int().min(1).max(100000),
  shippingFee: sen.nullable(),
  allowWhatsapp: z.boolean(),
  joinedMode: z.enum(['OFF', 'REAL', 'BOOST', 'FIXED']),
  joinedBoost: z.number().int().min(0).max(1000000),
  joinedFixed: z.number().int().min(0).max(1000000),
  joinedLabel: z.string().trim().min(1).max(80),
  bannerEnabled: z.boolean(),
  bannerText: text(200),
  bannerCta: text(40),
  bannerStartsAt: dateish,
  bannerEndsAt: dateish,
  bannerTone: z.enum(['INK', 'GREEN', 'COBALT']),
  popupEnabled: z.boolean(),
  popupTitle: text(120),
  popupBody: text(600),
  popupImageUrl: text(500),
  popupCta: text(40),
  popupStartsAt: dateish,
  popupEndsAt: dateish,
  popupDelaySec: z.number().int().min(0).max(120),
  popupFrequency: z.enum(['ONCE', 'DAILY', 'SESSION', 'EVERY']),
  popupPages: z.enum(['ALL', 'HOME', 'PRODUCTS']),
  homeEnabled: z.boolean(),
  homeTitle: text(120),
  homeBody: text(600),
  homeImageUrl: text(500),
  homeCta: text(40),
  rewardEnabled: z.boolean(),
  rewardType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
  rewardValue: z.number().int().min(0).max(10000000),
  rewardScope: z.enum(['GROUP_BUY', 'STORE', 'ANY']),
  rewardMinOrder: sen.nullable(),
  rewardValidDays: z.number().int().min(1).max(3650).nullable(),
  rewardMembersOnly: z.boolean(),
  rewardHeadline: text(160),
  notifyStageEmails: z.boolean(),
}).partial();

const DATE_FIELDS = ['opensAt', 'closesAt', 'bannerStartsAt', 'bannerEndsAt', 'popupStartsAt', 'popupEndsAt'] as const;

export async function adminUpdateGroupBuy(fastify: FastifyInstance, id: string, body: unknown) {
  const data = updateSchema.parse(body);
  const gb = await fastify.prisma.groupBuy.findUnique({ where: { id } });
  if (!gb) throw { statusCode: 404, message: 'Group Buy not found' };

  const patch: Record<string, unknown> = { ...data };
  for (const f of DATE_FIELDS) {
    if (data[f] !== undefined) patch[f] = data[f] === null ? null : new Date(data[f] as string);
  }
  const opensAt = (patch.opensAt as Date | undefined) ?? gb.opensAt;
  const closesAt = (patch.closesAt as Date | undefined) ?? gb.closesAt;
  if (closesAt <= opensAt) throw { statusCode: 400, message: 'The batch has to close after it opens.' };
  for (const [a, b, what] of [['bannerStartsAt', 'bannerEndsAt', 'banner'], ['popupStartsAt', 'popupEndsAt', 'popup']] as const) {
    const start = patch[a] !== undefined ? (patch[a] as Date | null) : gb[a];
    const end = patch[b] !== undefined ? (patch[b] as Date | null) : gb[b];
    if (start && end && end <= start) throw { statusCode: 400, message: `The ${what} has to end after it starts.` };
  }
  if (data.rewardType === 'PERCENTAGE' || (data.rewardType === undefined && gb.rewardType === 'PERCENTAGE')) {
    const v = data.rewardValue ?? gb.rewardValue;
    if (v > 100) throw { statusCode: 400, message: 'A percentage reward cannot be over 100%.' };
  }
  if (data.slug !== undefined) {
    const slug = slugify(data.slug);
    const taken = await fastify.prisma.groupBuy.findUnique({ where: { slug }, select: { id: true } });
    if (taken && taken.id !== id) throw { statusCode: 400, message: `The link /group-buy/${slug} is already used by another batch.` };
    patch.slug = slug;
  }
  if (data.published === true) {
    const items = await fastify.prisma.groupBuyItem.count({ where: { groupBuyId: id, active: true, tiers: { some: {} } } });
    if (items === 0) throw { statusCode: 400, message: 'Add at least one product with a price before publishing.' };
  }
  if (data.maxUnitsPerOrder !== undefined && data.maxUnitsPerOrder < gb.maxUnitsPerOrder) {
    const items = await fastify.prisma.groupBuyItem.findMany({
      where: { groupBuyId: id, active: true },
      include: { tiers: true, variant: { include: { product: { select: { name: true } } } } },
    });
    const blocked = items.find((it) => itemMinQty(it) > data.maxUnitsPerOrder!);
    if (blocked) {
      throw { statusCode: 400, message: `${getVariantDisplayName(blocked.variant.product, blocked.variant)} needs at least ${itemMinQty(blocked)} per order — the limit can't go below that.` };
    }
  }
  await fastify.prisma.groupBuy.update({ where: { id }, data: patch });
  return adminGetGroupBuy(fastify, id);
}

const itemsSchema = z.object({
  items: z.array(z.object({
    variantId: z.string().min(1),
    sellUnit: z.enum(['VIAL', 'KIT']),
    packSize: z.number().int().min(1).max(1000),
    unitLabel: text(40).optional(),
    minQty: z.number().int().min(1).nullable().optional(),
    maxQty: z.number().int().min(1).nullable().optional(),
    minAmount: sen.nullable().optional(),
    note: text(300).optional(),
    active: z.boolean().default(true),
    tiers: z.array(z.object({ minQty: z.number().int().min(1), price: z.number().int().min(1) })).max(20),
  })).max(200),
});

export async function adminSetGroupBuyItems(fastify: FastifyInstance, id: string, body: unknown) {
  const { items } = itemsSchema.parse(body);
  const gb = await fastify.prisma.groupBuy.findUnique({ where: { id } });
  if (!gb) throw { statusCode: 404, message: 'Group Buy not found' };

  const ids = items.map((i) => i.variantId);
  if (new Set(ids).size !== ids.length) throw { statusCode: 400, message: 'A product size is listed twice.' };
  const variants = await fastify.prisma.productVariant.findMany({ where: { id: { in: ids } }, include: { product: { select: { name: true } } } });
  const nameOf = (vid: string) => {
    const v = variants.find((x) => x.id === vid);
    return v ? getVariantDisplayName(v.product, v) : 'A product';
  };
  if (variants.length !== ids.length) throw { statusCode: 400, message: 'One of these product sizes no longer exists.' };

  for (const it of items) {
    const name = nameOf(it.variantId);
    if (it.sellUnit === 'KIT' && it.packSize < 2) throw { statusCode: 400, message: `${name}: a kit needs at least 2 vials.` };
    if (it.active && it.tiers.length === 0) throw { statusCode: 400, message: `${name}: add at least one price.` };
    const mins = it.tiers.map((t) => t.minQty);
    if (new Set(mins).size !== mins.length) throw { statusCode: 400, message: `${name}: two prices start at the same quantity.` };
    for (const t of it.tiers) {
      const problem = kitPriceProblem(it.sellUnit, it.packSize, t.price);
      if (problem) throw { statusCode: 400, message: `${name}: ${problem}` };
    }
    // The least a customer can order is the item's minimum or its first price,
    // whichever is higher — a cap below that makes the item unbuyable.
    const least = itemMinQty({ ...it, minQty: it.minQty ?? null, maxQty: it.maxQty ?? null, minAmount: it.minAmount ?? null });
    if (it.maxQty != null && it.maxQty < least) {
      throw { statusCode: 400, message: `${name}: the most per order (${it.maxQty}) is below the least anyone can order (${least}).` };
    }
    if (it.active && least > gb.maxUnitsPerOrder) {
      throw { statusCode: 400, message: `${name}: its minimum of ${least} is over the batch's ${gb.maxUnitsPerOrder}-unit limit per order.` };
    }
  }

  await fastify.prisma.$transaction(async (tx) => {
    await tx.groupBuyItem.deleteMany({ where: { groupBuyId: id, variantId: { notIn: ids } } });
    for (const [i, it] of items.entries()) {
      const row = await tx.groupBuyItem.upsert({
        where: { groupBuyId_variantId: { groupBuyId: id, variantId: it.variantId } },
        create: {
          groupBuyId: id, variantId: it.variantId, sortOrder: i, sellUnit: it.sellUnit, packSize: it.packSize,
          unitLabel: it.unitLabel ?? null, minQty: it.minQty ?? null, maxQty: it.maxQty ?? null, minAmount: it.minAmount ?? null,
          note: it.note ?? null, active: it.active,
        },
        update: {
          sortOrder: i, sellUnit: it.sellUnit, packSize: it.packSize, unitLabel: it.unitLabel ?? null,
          minQty: it.minQty ?? null, maxQty: it.maxQty ?? null, minAmount: it.minAmount ?? null, note: it.note ?? null, active: it.active,
        },
      });
      await tx.groupBuyTier.deleteMany({ where: { itemId: row.id } });
      if (it.tiers.length) await tx.groupBuyTier.createMany({ data: it.tiers.map((t) => ({ itemId: row.id, minQty: t.minQty, price: t.price })) });
    }
  });
  return adminGetGroupBuy(fastify, id);
}

const stageSchema = z.object({
  key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/i, 'Stage keys are letters, numbers and dashes'),
  label: z.string().trim().min(1).max(80),
  detail: text(400).optional(),
  eta: text(80).optional(),
  doneAt: z.string().nullable().optional(),
  note: text(600).optional(),
});

const stagesSchema = z.object({
  stages: z.array(stageSchema).min(1).max(20),
  stageKey: z.string().min(1),
  // Defaults to the batch's notifyStageEmails when absent.
  notify: z.boolean().optional(),
});

/**
 * Save the timeline. Moving the current stage forward stamps every step up to
 * it that has no date yet; moving it back clears the dates after it. When the
 * stage changed and notify is on, every paid buyer gets the update (once per
 * stage, even if this is saved twice).
 */
export async function adminSetGroupBuyStages(fastify: FastifyInstance, id: string, body: unknown) {
  const { stages, stageKey, notify } = stagesSchema.parse(body);
  const gb = await fastify.prisma.groupBuy.findUnique({ where: { id } });
  if (!gb) throw { statusCode: 404, message: 'Group Buy not found' };
  const keys = stages.map((s) => s.key);
  if (new Set(keys).size !== keys.length) throw { statusCode: 400, message: 'Two stages share a key.' };
  const at = keys.indexOf(stageKey);
  if (at < 0) throw { statusCode: 400, message: 'The current stage is not in the list.' };

  const nowIso = new Date().toISOString();
  const next: GroupBuyStage[] = stages.map((s, i) => ({
    key: s.key,
    label: s.label,
    detail: s.detail ?? null,
    eta: s.eta ?? null,
    note: s.note ?? null,
    doneAt: i <= at ? s.doneAt || nowIso : null,
  }));
  const moved = stageKey !== gb.stageKey;
  await fastify.prisma.groupBuy.update({ where: { id }, data: { stages: next as unknown as object, stageKey } });
  let queued = 0;
  if (moved && (notify ?? gb.notifyStageEmails)) queued = await enqueueStageNotices(fastify, id, stageKey);
  return { ...(await adminGetGroupBuy(fastify, id)), queued };
}

/** Resend the current stage's update to buyers who have not had it (late payers, mostly). */
export async function adminNotifyCurrentStage(fastify: FastifyInstance, id: string) {
  const gb = await fastify.prisma.groupBuy.findUnique({ where: { id }, select: { stageKey: true } });
  if (!gb) throw { statusCode: 404, message: 'Group Buy not found' };
  return { queued: await enqueueStageNotices(fastify, id, gb.stageKey) };
}

export async function adminDuplicateGroupBuy(fastify: FastifyInstance, id: string) {
  const src = await fastify.prisma.groupBuy.findUnique({ where: { id }, include: { items: { include: { tiers: true } } } });
  if (!src) throw { statusCode: 404, message: 'Group Buy not found' };
  const fresh = await adminCreateGroupBuy(fastify, { title: src.title.replace(/Batch \d+/i, '').trim() || undefined });
  const {
    id: _id, number: _n, slug: _s, title: _t, published: _p, opensAt: _o, closesAt: _c, stages, stageKey: _k,
    createdAt: _ca, updatedAt: _ua, items, bannerStartsAt: _bs, bannerEndsAt: _be, popupStartsAt: _ps, popupEndsAt: _pe, ...rest
  } = src;
  const label = batchLabel(fresh.number);
  const relabel = (s: string | null) => (s ? s.replace(/Batch \d+/gi, label) : s);
  await fastify.prisma.groupBuy.update({
    where: { id: fresh.id },
    data: {
      ...rest,
      title: relabel(src.title) ?? fresh.title,
      bannerText: relabel(rest.bannerText),
      popupTitle: relabel(rest.popupTitle),
      homeTitle: relabel(rest.homeTitle),
      stages: parseStages(stages).map((s) => ({ ...s, doneAt: null, note: null })) as unknown as object,
      stageKey: parseStages(stages)[0]?.key ?? 'open',
    },
  });
  for (const it of items) {
    await fastify.prisma.groupBuyItem.create({
      data: {
        groupBuyId: fresh.id, variantId: it.variantId, sortOrder: it.sortOrder, sellUnit: it.sellUnit, packSize: it.packSize,
        unitLabel: it.unitLabel, minQty: it.minQty, maxQty: it.maxQty, minAmount: it.minAmount, note: it.note, active: it.active,
        tiers: { create: it.tiers.map((t) => ({ minQty: t.minQty, price: t.price })) },
      },
    });
  }
  return adminGetGroupBuy(fastify, fresh.id);
}

export async function adminDeleteGroupBuy(fastify: FastifyInstance, id: string) {
  const orders = await fastify.prisma.order.count({ where: { groupBuyId: id } });
  if (orders > 0) throw { statusCode: 400, message: `This batch has ${orders} order${orders === 1 ? '' : 's'} — unpublish it instead.` };
  await fastify.prisma.discountCode.updateMany({ where: { groupBuyId: id }, data: { isActive: false } });
  await fastify.prisma.groupBuy.delete({ where: { id } });
  return { ok: true };
}

export async function adminGroupBuyOrders(fastify: FastifyInstance, id: string) {
  const orders = await fastify.prisma.order.findMany({
    where: { groupBuyId: id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, orderNumber: true, customerName: true, email: true, phone: true, status: true, paymentStatus: true,
      total: true, discountAmount: true, createdAt: true, trackingNumber: true,
      discountCode: { select: { code: true } },
      items: { where: { parentItemId: null }, select: { quantity: true, packSize: true, variant: { select: { code: true } } } },
    },
  });
  return orders.map(({ items, ...o }) => ({
    ...o,
    summary: items.map((i) => (i.packSize ? `${i.quantity / i.packSize}× ${i.variant.code} kit` : `${i.quantity}× ${i.variant.code}`)).join(', '),
    vials: items.reduce((s, i) => s + i.quantity, 0),
  }));
}

/**
 * What to order from the supplier: vials per size across the batch, split by
 * paid and still unpaid, with what the store already holds beside it.
 */
export async function adminGroupBuySupplierSheet(fastify: FastifyInstance, id: string) {
  const items = await fastify.prisma.orderItem.findMany({
    where: { order: { groupBuyId: id, ...LIVE_ORDER } },
    select: { variantId: true, quantity: true, packSize: true, order: { select: { paymentStatus: true } } },
  });
  const byVariant = new Map<string, { paid: number; unpaid: number; packSize: number | null }>();
  for (const it of items) {
    const row = byVariant.get(it.variantId) ?? { paid: 0, unpaid: 0, packSize: it.packSize };
    if (it.order.paymentStatus === 'PAID') row.paid += it.quantity;
    else if (it.order.paymentStatus === 'UNPAID') row.unpaid += it.quantity;
    byVariant.set(it.variantId, row);
  }
  const variants = await fastify.prisma.productVariant.findMany({
    where: { id: { in: [...byVariant.keys()] } },
    include: { product: { select: { name: true } } },
  });
  return variants
    .map((v) => {
      const r = byVariant.get(v.id)!;
      return { variantId: v.id, name: getVariantDisplayName(v.product, v), code: v.code, stock: v.stock, paidVials: r.paid, unpaidVials: r.unpaid, packSize: r.packSize };
    })
    .sort((a, b) => b.paidVials - a.paidVials || a.name.localeCompare(b.name));
}

export async function adminGroupBuySignups(fastify: FastifyInstance, id: string) {
  const [signups, orders] = await Promise.all([
    fastify.prisma.groupBuySignup.findMany({
      where: { groupBuyId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        discountCode: { select: { code: true, usedCount: true, maxUses: true, isActive: true, expiresAt: true, discountType: true, discountValue: true } },
        member: { select: { id: true, displayName: true, emailVerified: true } },
      },
    }),
    fastify.prisma.order.findMany({
      where: { groupBuyId: id, deletedAt: null, status: { not: 'CANCELLED' } },
      select: { email: true, phone: true, total: true, paymentStatus: true, orderNumber: true, id: true },
    }),
  ]);
  return signups.map((s) => {
    const mine = orders.filter((o) => (o.email && o.email.toLowerCase() === s.email) || (s.phone && normalizePhone(o.phone) === s.phone));
    const paid = mine.filter((o) => o.paymentStatus === 'PAID');
    return {
      id: s.id,
      email: s.email,
      name: s.name,
      phone: s.phone,
      source: s.source,
      note: s.note,
      createdAt: s.createdAt,
      member: s.member,
      reward: s.discountCode
        ? {
            code: s.discountCode.code,
            used: s.discountCode.maxUses != null && s.discountCode.usedCount >= s.discountCode.maxUses,
            active: s.discountCode.isActive,
            expiresAt: s.discountCode.expiresAt,
            label: s.discountCode.discountType === 'PERCENTAGE' ? `${s.discountCode.discountValue}%` : `RM${(s.discountCode.discountValue / 100).toFixed(2)}`,
          }
        : null,
      orders: mine.map((o) => ({ id: o.id, orderNumber: o.orderNumber, paymentStatus: o.paymentStatus, total: o.total })),
      paidTotal: paid.reduce((t, o) => t + o.total, 0),
    };
  });
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function adminGroupBuySignupsCsv(fastify: FastifyInstance, id: string) {
  const gb = await fastify.prisma.groupBuy.findUnique({ where: { id }, select: { number: true } });
  if (!gb) throw { statusCode: 404, message: 'Group Buy not found' };
  const rows = await adminGroupBuySignups(fastify, id);
  const head = ['Joined', 'Name', 'Email', 'Phone', 'Source', 'Member', 'Reward code', 'Reward used', 'Orders', 'Paid (RM)', 'Note'];
  const lines = rows.map((r) => [
    r.createdAt.toISOString(), r.name, r.email, r.phone, r.source, r.member ? 'yes' : 'no', r.reward?.code, r.reward ? (r.reward.used ? 'yes' : 'no') : '',
    r.orders.map((o) => o.orderNumber).join(' '), (r.paidTotal / 100).toFixed(2), r.note,
  ].map(csvCell).join(','));
  const day = new Date().toISOString().slice(0, 10);
  return {
    csv: [head.join(','), ...lines].join('\n'),
    filename: `ascend-group-buy-batch-${String(gb.number).padStart(2, '0')}-signups-${day}.csv`,
  };
}

const addSignupSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(120).optional(),
  phone: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(6).max(30).transform(normalizePhone).optional()),
  note: z.string().trim().max(500).optional(),
});

export async function adminAddSignup(fastify: FastifyInstance, id: string, body: unknown) {
  const data = addSignupSchema.parse(body);
  const gb = await fastify.prisma.groupBuy.findUnique({ where: { id } });
  if (!gb) throw { statusCode: 404, message: 'Group Buy not found' };
  return createSignup(fastify, gb, { ...data, source: 'ADMIN' });
}

export async function adminUpdateSignup(fastify: FastifyInstance, id: string, signupId: string, body: unknown) {
  const { note } = z.object({ note: z.string().max(500).nullable() }).parse(body);
  const s = await fastify.prisma.groupBuySignup.findFirst({ where: { id: signupId, groupBuyId: id } });
  if (!s) throw { statusCode: 404, message: 'Sign-up not found' };
  await fastify.prisma.groupBuySignup.update({ where: { id: signupId }, data: { note } });
  return { ok: true };
}

export async function adminDeleteSignup(fastify: FastifyInstance, id: string, signupId: string) {
  const s = await fastify.prisma.groupBuySignup.findFirst({ where: { id: signupId, groupBuyId: id } });
  if (!s) throw { statusCode: 404, message: 'Sign-up not found' };
  // Their reward goes with them, unless it was already spent.
  if (s.discountCodeId) await fastify.prisma.discountCode.updateMany({ where: { id: s.discountCodeId, usedCount: 0 }, data: { isActive: false } });
  await fastify.prisma.groupBuySignup.delete({ where: { id: signupId } });
  return { ok: true };
}

export async function adminGroupBuyNotices(fastify: FastifyInstance, id: string) {
  return fastify.prisma.groupBuyNotice.findMany({
    where: { groupBuyId: id },
    orderBy: { createdAt: 'desc' },
    take: 300,
    select: { id: true, kind: true, stageKey: true, toEmail: true, status: true, attempts: true, lastError: true, sentAt: true, createdAt: true },
  });
}

export async function adminPreviewGroupBuyEmail(fastify: FastifyInstance, id: string, query: { kind?: string; stageKey?: string }) {
  const kind = query.kind === 'STAGE' ? 'STAGE' : 'SIGNUP';
  const gb = await fastify.prisma.groupBuy.findUnique({ where: { id } });
  if (!gb) throw { statusCode: 404, message: 'Group Buy not found' };
  if (kind === 'SIGNUP') {
    // A made-up code so the preview shows exactly what a new sign-up gets.
    const rendered = await renderNotice(fastify, { kind, groupBuyId: id, orderId: null, signupId: null, stageKey: null });
    if (!rendered) throw { statusCode: 404, message: 'Nothing to preview' };
    if (!gb.rewardEnabled || gb.rewardValue <= 0) return rendered;
    const { renderGroupBuySignup } = await import('../../emails/group-buy.js');
    const settings = Object.fromEntries((await fastify.prisma.setting.findMany()).map((s) => [s.key, s.value]));
    return renderGroupBuySignup(gb, 'Aisyah', {
      code: `GB${String(gb.number).padStart(2, '0')}-SAMPLE`, type: gb.rewardType, value: gb.rewardValue,
      expiresAt: gb.rewardValidDays ? new Date(Date.now() + gb.rewardValidDays * 86400000) : null,
      minOrderAmount: gb.rewardMinOrder, scope: gb.rewardScope === 'ANY' ? null : gb.rewardScope,
    }, settings);
  }
  const rendered = await renderNotice(fastify, { kind, groupBuyId: id, orderId: null, signupId: null, stageKey: query.stageKey ?? gb.stageKey });
  if (!rendered) throw { statusCode: 404, message: 'Nothing to preview' };
  return rendered;
}

/** Every sellable size, for the batch's product picker. */
export async function adminGroupBuyVariants(fastify: FastifyInstance) {
  const now = new Date();
  const variants = await fastify.prisma.productVariant.findMany({
    where: { active: true, product: { active: true, addOnOnly: false } },
    include: { product: { select: { name: true } } },
    orderBy: [{ product: { name: 'asc' } }, { price: 'asc' }],
  });
  return variants.map((v) => ({
    id: v.id,
    name: getVariantDisplayName(v.product, v),
    code: v.code,
    size: v.size,
    imageUrl: v.imageUrl,
    stock: v.stock,
    storePrice: getEffectivePrice(v, now),
  }));
}
