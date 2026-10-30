import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { normalizePhone } from '../../utils/phone.js';
import { getVariantDisplayName } from '../../utils/product-addons.js';
import { getEffectivePrice } from '../../utils/product-pricing.js';
import { parseTracking } from '../../utils/courier.js';
import { resolveShippingFeeSen } from '../../utils/shipping-region.js';
import {
  batchLabel, groupBuyPhase, inWindow, itemMinQty, joinedCount, parseStages, sortTiers, GROUP_BUY_ORDER_INCLUDE,
  type GroupBuyForOrder,
} from '../../utils/group-buy.js';
import { createSignup } from '../../utils/group-buy-signup.js';

/**
 * The public side of Group Buy: the batch list, a batch's page, the storefront
 * promo (banner, popup, home section), joining a batch's list, and a signed-in
 * member's own orders. Nothing here exposes another customer's data: the
 * joined counter is a number the team chooses to show, never a list.
 */

/** A signed-in member, if the request carries a member token. Never throws. */
export async function optionalMember(fastify: FastifyInstance, request: FastifyRequest) {
  try {
    await request.jwtVerify();
  } catch {
    return null;
  }
  if (request.user.kind !== 'member') return null;
  const member = await fastify.prisma.member.findUnique({
    where: { id: request.user.id },
    select: { id: true, email: true, displayName: true, emailVerified: true, banned: true },
  });
  return member && !member.banned ? member : null;
}

async function realJoined(fastify: FastifyInstance, groupBuyId: string): Promise<number> {
  return fastify.prisma.groupBuySignup.count({ where: { groupBuyId } });
}

function publicReward(gb: GroupBuyForOrder) {
  if (!gb.rewardEnabled || gb.rewardValue <= 0) return null;
  return {
    headline: gb.rewardHeadline,
    type: gb.rewardType,
    value: gb.rewardValue,
    scope: gb.rewardScope,
    minOrder: gb.rewardMinOrder,
    validDays: gb.rewardValidDays,
    membersOnly: gb.rewardMembersOnly,
  };
}

function publicItems(gb: GroupBuyForOrder, now: Date) {
  return gb.items
    .filter((it) => it.variant.active && it.variant.product.active && it.tiers.length > 0)
    .map((it) => ({
      id: it.id,
      variantId: it.variantId,
      name: getVariantDisplayName(it.variant.product, it.variant),
      productName: it.variant.product.name,
      productSlug: it.variant.product.slug,
      size: it.variant.size,
      code: it.variant.code,
      imageUrl: it.variant.imageUrl,
      sellUnit: it.sellUnit,
      packSize: it.packSize,
      unitLabel: it.unitLabel,
      minQty: itemMinQty(it),
      maxQty: it.maxQty,
      minAmount: it.minAmount,
      note: it.note,
      tiers: sortTiers(it.tiers).map((t) => ({ minQty: t.minQty, price: t.price })),
      // The store's own price for one vial, so the page can show the saving
      // against what the same vial costs in the shop today.
      storePrice: getEffectivePrice(it.variant, now),
    }));
}

function publicStages(gb: { stages: unknown; stageKey: string }) {
  return { stages: parseStages(gb.stages), stageKey: gb.stageKey };
}

export async function listGroupBuys(fastify: FastifyInstance) {
  const now = new Date();
  const recent = new Date(now.getTime() - 120 * 24 * 3600 * 1000);
  const rows = await fastify.prisma.groupBuy.findMany({
    where: { published: true, closesAt: { gte: recent } },
    include: GROUP_BUY_ORDER_INCLUDE,
    orderBy: { opensAt: 'desc' },
    take: 20,
  });
  const counts = await fastify.prisma.groupBuySignup.groupBy({ by: ['groupBuyId'], _count: true, where: { groupBuyId: { in: rows.map((r) => r.id) } } });
  return rows.map((gb) => {
    const items = publicItems(gb, now);
    const prices = items.flatMap((i) => i.tiers.map((t) => t.price));
    const real = counts.find((c) => c.groupBuyId === gb.id)?._count ?? 0;
    return {
      id: gb.id,
      number: gb.number,
      label: batchLabel(gb.number),
      slug: gb.slug,
      title: gb.title,
      tagline: gb.tagline,
      heroImageUrl: gb.heroImageUrl,
      phase: groupBuyPhase(gb, now),
      opensAt: gb.opensAt,
      closesAt: gb.closesAt,
      shipEstimate: gb.shipEstimate,
      itemCount: items.length,
      fromPrice: prices.length ? Math.min(...prices) : null,
      joined: joinedCount(gb, real),
      joinedLabel: gb.joinedLabel,
      reward: publicReward(gb),
      stageKey: gb.stageKey,
      stageLabel: parseStages(gb.stages).find((s) => s.key === gb.stageKey)?.label ?? null,
    };
  });
}

/** True when the request carries an admin token — lets the team preview a draft batch. */
async function isAdminRequest(request?: FastifyRequest): Promise<boolean> {
  if (!request?.headers.authorization) return false;
  try {
    await request.jwtVerify();
    return request.user.kind === undefined || request.user.kind === 'admin';
  } catch {
    return false;
  }
}

export async function getGroupBuy(fastify: FastifyInstance, slug: string, request?: FastifyRequest) {
  const now = new Date();
  const gb = await fastify.prisma.groupBuy.findUnique({ where: { slug }, include: GROUP_BUY_ORDER_INCLUDE });
  if (!gb || (!gb.published && !(await isAdminRequest(request)))) throw { statusCode: 404, message: 'Group Buy not found' };
  const shippingSetting = await fastify.prisma.setting.findUnique({ where: { key: 'shipping_fee' } });
  return {
    id: gb.id,
    number: gb.number,
    label: batchLabel(gb.number),
    slug: gb.slug,
    title: gb.title,
    tagline: gb.tagline,
    description: gb.description,
    heroImageUrl: gb.heroImageUrl,
    phase: groupBuyPhase(gb, now),
    opensAt: gb.opensAt,
    closesAt: gb.closesAt,
    shipEstimate: gb.shipEstimate,
    minOrderAmount: gb.minOrderAmount,
    maxUnitsPerOrder: gb.maxUnitsPerOrder,
    // What shipping will cost, said plainly: the batch's own fee, or the
    // store's when the batch keeps it (East Malaysia is settled at checkout).
    shippingFee: gb.shippingFee,
    storeShippingFee: resolveShippingFeeSen(shippingSetting?.value, null, false),
    allowWhatsapp: gb.allowWhatsapp,
    joined: joinedCount(gb, await realJoined(fastify, gb.id)),
    joinedLabel: gb.joinedLabel,
    reward: publicReward(gb),
    ...publicStages(gb),
    items: publicItems(gb, now),
  };
}

/**
 * What the storefront shows for Group Buy right now: at most one banner, one
 * popup and one home section, each from the first batch (live before
 * upcoming) that has it switched on and inside its schedule.
 */
export async function getGroupBuyPromo(fastify: FastifyInstance) {
  const now = new Date();
  const rows = await fastify.prisma.groupBuy.findMany({
    where: {
      published: true,
      closesAt: { gt: now },
      OR: [{ bannerEnabled: true }, { popupEnabled: true }, { homeEnabled: true }],
    },
    include: GROUP_BUY_ORDER_INCLUDE,
    orderBy: { opensAt: 'asc' },
  });
  const ordered = [...rows].sort((a, b) => {
    const rank = (g: typeof a) => (groupBuyPhase(g, now) === 'LIVE' ? 0 : 1);
    return rank(a) - rank(b);
  });
  const base = (gb: GroupBuyForOrder) => ({ slug: gb.slug, number: gb.number, label: batchLabel(gb.number), phase: groupBuyPhase(gb, now), opensAt: gb.opensAt, closesAt: gb.closesAt });

  const bannerGb = ordered.find((g) => g.bannerEnabled && g.bannerText && inWindow(g.bannerStartsAt, g.bannerEndsAt, now));
  const popupGb = ordered.find((g) => g.popupEnabled && g.popupTitle && inWindow(g.popupStartsAt, g.popupEndsAt, now));
  const homeGb = ordered.find((g) => g.homeEnabled);

  let home = null;
  if (homeGb) {
    const items = publicItems(homeGb, now);
    home = {
      ...base(homeGb),
      id: homeGb.id,
      title: homeGb.homeTitle || homeGb.title,
      body: homeGb.homeBody || homeGb.tagline,
      imageUrl: homeGb.homeImageUrl || homeGb.heroImageUrl,
      cta: homeGb.homeCta || 'See the batch',
      shipEstimate: homeGb.shipEstimate,
      joined: joinedCount(homeGb, await realJoined(fastify, homeGb.id)),
      joinedLabel: homeGb.joinedLabel,
      reward: publicReward(homeGb),
      items: items.slice(0, 6).map((i) => ({ name: i.name, imageUrl: i.imageUrl, sellUnit: i.sellUnit, packSize: i.packSize, unitLabel: i.unitLabel, tiers: i.tiers, storePrice: i.storePrice })),
      itemCount: items.length,
    };
  }

  return {
    banner: bannerGb ? { ...base(bannerGb), text: bannerGb.bannerText, cta: bannerGb.bannerCta || 'Join the batch', tone: bannerGb.bannerTone } : null,
    popup: popupGb
      ? {
          ...base(popupGb),
          // Changes whenever the popup's copy or schedule changes, so a
          // shopper who closed last week's popup still sees the new one.
          key: `${popupGb.id}:${popupGb.updatedAt.getTime()}`,
          title: popupGb.popupTitle,
          body: popupGb.popupBody,
          imageUrl: popupGb.popupImageUrl,
          cta: popupGb.popupCta || 'See the batch',
          delaySec: popupGb.popupDelaySec,
          frequency: popupGb.popupFrequency,
          pages: popupGb.popupPages,
          reward: publicReward(popupGb),
        }
      : null,
    home,
  };
}

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(120).optional(),
  phone: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(6).max(30).transform(normalizePhone).optional()),
  source: z.enum(['PAGE', 'POPUP', 'HOME']).default('PAGE'),
});

export async function signupToGroupBuy(fastify: FastifyInstance, request: FastifyRequest, slug: string) {
  const data = signupSchema.parse(request.body);
  const gb = await fastify.prisma.groupBuy.findUnique({ where: { slug } });
  if (!gb || !gb.published) throw { statusCode: 404, message: 'Group Buy not found' };
  if (groupBuyPhase(gb) === 'CLOSED') throw { statusCode: 400, message: `${batchLabel(gb.number)} has closed.` };
  const member = await optionalMember(fastify, request);
  return createSignup(fastify, gb, { ...data, member });
}

/**
 * A signed-in member's orders and batches. Matched by email only once that
 * email is confirmed — an unconfirmed account could otherwise claim anyone's
 * orders by registering their address.
 */
export async function getMyGroupBuys(fastify: FastifyInstance, member: { id: string; email: string; emailVerified: boolean }) {
  const email = member.email.trim().toLowerCase();
  const signups = await fastify.prisma.groupBuySignup.findMany({
    where: { OR: [{ memberId: member.id }, ...(member.emailVerified ? [{ email }] : [])] },
    include: {
      groupBuy: { select: { id: true, number: true, slug: true, title: true, opensAt: true, closesAt: true, published: true, stageKey: true, stages: true } },
      discountCode: { select: { code: true, discountType: true, discountValue: true, usedCount: true, maxUses: true, expiresAt: true, isActive: true, minOrderAmount: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!member.emailVerified) {
    return { verified: false, orders: [], signups: signups.map(shapeSignup) };
  }
  const orders = await fastify.prisma.order.findMany({
    where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null },
    select: {
      id: true, orderNumber: true, status: true, paymentStatus: true, paymentMethod: true, createdAt: true,
      subtotal: true, shippingFee: true, discountAmount: true, refundedAmount: true, total: true, trackingNumber: true,
      paidAt: true, confirmedAt: true, shippedAt: true, deliveredAt: true, cancelledAt: true, isPreorder: true, phone: true,
      groupBuy: { select: { id: true, number: true, slug: true, title: true, shipEstimate: true, stages: true, stageKey: true, closesAt: true } },
      items: {
        select: {
          id: true, quantity: true, unitPrice: true, parentItemId: true, preorderQty: true, packSize: true,
          variant: { select: { code: true, size: true, imageUrl: true, product: { select: { name: true, addOnOnly: true, slug: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return {
    verified: true,
    signups: signups.map(shapeSignup),
    orders: orders.map(({ trackingNumber, groupBuy, ...o }) => ({
      ...o,
      tracking: parseTracking(trackingNumber),
      groupBuy: groupBuy ? { ...groupBuy, label: batchLabel(groupBuy.number), stages: parseStages(groupBuy.stages) } : null,
    })),
  };
}

function shapeSignup(s: {
  id: string; createdAt: Date; source: string;
  groupBuy: { id: string; number: number; slug: string; title: string; opensAt: Date; closesAt: Date; published: boolean; stageKey: string; stages: unknown };
  discountCode: { code: string; discountType: string; discountValue: number; usedCount: number; maxUses: number | null; expiresAt: Date | null; isActive: boolean; minOrderAmount: number | null } | null;
}) {
  return {
    id: s.id,
    createdAt: s.createdAt,
    source: s.source,
    groupBuy: {
      id: s.groupBuy.id, number: s.groupBuy.number, label: batchLabel(s.groupBuy.number), slug: s.groupBuy.slug, title: s.groupBuy.title,
      opensAt: s.groupBuy.opensAt, closesAt: s.groupBuy.closesAt, phase: groupBuyPhase(s.groupBuy),
      stageKey: s.groupBuy.stageKey, stageLabel: parseStages(s.groupBuy.stages).find((x) => x.key === s.groupBuy.stageKey)?.label ?? null,
    },
    reward: s.discountCode
      ? {
          code: s.discountCode.code,
          type: s.discountCode.discountType,
          value: s.discountCode.discountValue,
          used: s.discountCode.maxUses != null && s.discountCode.usedCount >= s.discountCode.maxUses,
          expiresAt: s.discountCode.expiresAt,
          active: s.discountCode.isActive,
          minOrder: s.discountCode.minOrderAmount,
        }
      : null,
  };
}
