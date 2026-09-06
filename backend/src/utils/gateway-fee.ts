import type { FastifyInstance } from 'fastify';

/**
 * What the payment processor keeps out of an order's total.
 *
 * This existed nowhere before. Every online order's profit was therefore
 * overstated by the processor's cut, and the cash that actually landed in the
 * bank was always less than the `total` the books reported — quietly, and by a
 * bigger proportion the smaller the order.
 *
 * The fee is recorded ON THE ORDER at the moment it is confirmed paid, not
 * derived at read time. A published rate is a schedule, not a promise: it
 * changes, it varies by channel, and a settlement can differ from either. What
 * an order actually cost to collect is a fact about that order and must not
 * move when a rate is edited months later — the same reasoning that puts
 * `unitCost` on OrderItem rather than on ProductVariant.
 *
 * Each gateway's rule is `flat + bps` so both shapes are expressible: ToyyibPay
 * charges a flat sum per FPX transaction, card processors charge a percentage,
 * and a rule can carry both.
 */

export interface FeeRule {
  /** Cents charged per transaction regardless of size. */
  flat: number;
  /** Basis points of the order total. 250 = 2.5%. */
  bps: number;
}

/**
 * Defaults, overridable per gateway from Settings.
 *
 * ToyyibPay's published FPX B2C rate is RM1.00 a transaction, and this account
 * absorbs the DuitNow QR charge too (chargeDuitNowQR=0 in utils/toyyibpay.ts),
 * so the fee is ours either way. Billplz's FPX rate is the same shape.
 *
 * BTCPay is self-hosted: there is no processor and no cut, so its zero is a
 * real figure rather than a placeholder. Orders with no gateway at all
 * (WhatsApp, manual bank transfer) never reach this table and stay at zero.
 *
 * These are starting values. Set the real, contracted numbers in Settings —
 * `gateway_fee_toyyibpay_flat` / `_bps` and the billplz equivalents — and every
 * order confirmed after that uses them.
 */
const DEFAULT_RULES: Record<string, FeeRule> = {
  toyyibpay: { flat: 100, bps: 0 },
  billplz: { flat: 100, bps: 0 },
  btcpay: { flat: 0, bps: 0 },
};

export function settingKeys(gateway: string): { flat: string; bps: string } {
  return { flat: `gateway_fee_${gateway}_flat`, bps: `gateway_fee_${gateway}_bps` };
}

/** Every settings key this module reads, for the admin settings form. */
export const GATEWAY_FEE_SETTING_KEYS = Object.keys(DEFAULT_RULES).flatMap((g) => {
  const k = settingKeys(g);
  return [k.flat, k.bps];
});

/**
 * Parse one override. A blank, missing or malformed value falls back to the
 * default rather than to zero: silently charging nothing because someone typed
 * "RM1" into a cents field is exactly the kind of quiet wrong number this
 * whole change exists to remove.
 */
function override(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

export function feeFromRule(rule: FeeRule, total: number): number {
  // Never more than the order itself — a misconfigured rule should produce a
  // pinned figure someone will notice, not a negative revenue line.
  return Math.min(total, rule.flat + Math.round((total * rule.bps) / 10_000));
}

/**
 * The fee to record for one order. `gateway` is `Order.paymentGateway`, which is
 * null for WhatsApp and manual transfers — those cost nothing to collect.
 */
export async function computeGatewayFee(
  fastify: FastifyInstance,
  gateway: string | null | undefined,
  total: number
): Promise<number> {
  if (!gateway) return 0;
  const base = DEFAULT_RULES[gateway];
  if (!base) return 0;

  const keys = settingKeys(gateway);
  const rows = await fastify.prisma.setting.findMany({
    where: { key: { in: [keys.flat, keys.bps] } },
  });
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return feeFromRule(
    {
      flat: override(byKey[keys.flat], base.flat),
      bps: override(byKey[keys.bps], base.bps),
    },
    total
  );
}
