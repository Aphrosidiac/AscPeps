/**
 * Shadow SKUs — resolving a real order into its generalised, internal-only
 * vocabulary.
 *
 * A shadow name is a *less specific but still accurate* description of a SKU
 * ("Research peptide, 10mg vial" for a named compound). It exists for internal
 * paperwork that has no need to name a compound: stock sheets, supplier POs,
 * and the internal order summary. It is not, and must never become, a second
 * receipt — see the header enforced in utils/internal-summary-pdf.ts.
 *
 * Resolution is always live, against the current mapping. There is deliberately
 * no snapshot: the sheet is internal, regenerable on demand, and never handed
 * to anyone, so freezing its wording would only mean an old sheet quietly
 * disagreeing with the mapping the admin is looking at. Change a shadow name
 * and every sheet says the new thing, which is the behaviour anyone editing a
 * mapping actually expects.
 *
 * The one hard rule is that an unmapped SKU is refused, never defaulted.
 * Falling back to the real name would put the real name on the one document
 * whose entire purpose is not to carry it, and would do it silently.
 */

import type { FastifyInstance } from 'fastify';
import { getVariantDisplayName } from './product-addons.js';

/** The shape any caller must select to resolve an order's shadow lines. */
export interface ShadowResolvableItem {
  id: string;
  quantity: number;
  unitPrice: number;
  variant: {
    code: string;
    size: string | null;
    product: { name: string };
    shadowSku: { code: string; name: string } | null;
  };
}

/** The Prisma `include` that produces a ShadowResolvableItem. */
export const SHADOW_ITEM_INCLUDE = {
  variant: {
    select: {
      code: true,
      size: true,
      product: { select: { name: true } },
      shadowSku: { select: { code: true, name: true } },
    },
  },
} as const;

export interface ResolvedShadowLine {
  itemId: string;
  quantity: number;
  unitPrice: number;
  /** What the sheet prints. */
  code: string;
  name: string;
  /**
   * What it really is. Carried so the admin can see the mapping it is about to
   * print — this is an operator-facing field and never reaches the PDF.
   */
  realName: string;
  realCode: string;
}

export interface UnmappedShadowLine {
  itemId: string;
  quantity: number;
  realName: string;
  realCode: string;
}

export interface ShadowResolution {
  lines: ResolvedShadowLine[];
  unmapped: UnmappedShadowLine[];
  /** Nothing unmapped: a sheet can be produced. */
  complete: boolean;
}

/**
 * Resolve every line of an order to its shadow name. Pure — reads nothing,
 * writes nothing, and is safe to call on every render.
 */
export function resolveShadowLines(items: ShadowResolvableItem[]): ShadowResolution {
  const lines: ResolvedShadowLine[] = [];
  const unmapped: UnmappedShadowLine[] = [];

  for (const item of items) {
    const realName = getVariantDisplayName(item.variant.product, item.variant);
    const shadow = item.variant.shadowSku;

    if (!shadow) {
      unmapped.push({
        itemId: item.id,
        quantity: item.quantity,
        realName,
        realCode: item.variant.code,
      });
      continue;
    }

    lines.push({
      itemId: item.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      code: shadow.code,
      name: shadow.name,
      realName,
      realCode: item.variant.code,
    });
  }

  return { lines, unmapped, complete: unmapped.length === 0 };
}

export interface ShadowCoverage {
  /** Sellable variants, i.e. the ones that can still end up on a new order. */
  activeVariants: number;
  mapped: number;
  unmapped: number;
  shadowCount: number;
  activeShadowCount: number;
}

/**
 * The headline the mapping page leads with. Counts active variants only —
 * a retired SKU with no shadow is not a gap anyone needs to close.
 */
export async function shadowCoverage(fastify: FastifyInstance): Promise<ShadowCoverage> {
  const [activeVariants, mapped, shadowCount, activeShadowCount] = await Promise.all([
    fastify.prisma.productVariant.count({ where: { active: true } }),
    fastify.prisma.productVariant.count({ where: { active: true, shadowSkuId: { not: null } } }),
    fastify.prisma.shadowSku.count(),
    fastify.prisma.shadowSku.count({ where: { active: true } }),
  ]);

  return {
    activeVariants,
    mapped,
    unmapped: activeVariants - mapped,
    shadowCount,
    activeShadowCount,
  };
}
