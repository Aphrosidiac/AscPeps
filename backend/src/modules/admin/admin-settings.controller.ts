import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getActiveGateway } from '../../utils/payment-gateway.js';
import { notifyRevalidate } from '../../utils/revalidate.js';
import { checkoutConfigSchema } from 'manualpaygate/core';
import { MANUALPAY_CONFIG_KEY, MANUALPAY_ENABLED_KEY, loadManualPayConfig } from '../../plugins/manualpay.js';

export async function getSettings(fastify: FastifyInstance) {
  const settings = await fastify.prisma.setting.findMany();
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}

const updateSettingsSchema = z.record(z.string(), z.string());

// Settings whose value must be a non-negative finite number (stored as a string).
const NUMERIC_SETTINGS = new Set([
  'shipping_fee',
  'welcome_discount_days',
  'welcome_discount_min_order',
  // Minimum order value (RM) required to ship to Sabah, Sarawak or Labuan.
  // Blank or 0 switches the rule off entirely — see utils/shipping-region.ts.
  'east_malaysia_min_order',
  // Shipping fee (RM) for those same states. Blank falls back to the standard
  // shipping_fee; an explicit 0 means free.
  'east_malaysia_shipping_fee',
]);

// Numeric settings with a hard ceiling as well as a floor. The welcome
// discount is a percentage that gets minted straight into a real, redeemable
// DiscountCode — a fat-fingered "100" is a free order and anything above it is
// nonsense, so the bound is enforced here rather than trusted from the form.
const BOUNDED_SETTINGS: Record<string, { min: number; max: number }> = {
  welcome_discount_percent: { min: 0, max: 100 },
};

export async function updateSettings(fastify: FastifyInstance, body: unknown) {
  const data = updateSettingsSchema.parse(body);

  for (const [key, value] of Object.entries(data)) {
    if (NUMERIC_SETTINGS.has(key)) {
      // Blank clears an optional numeric setting rather than failing.
      if (value.trim() === '') continue;
      const n = parseFloat(value);
      if (!Number.isFinite(n) || n < 0) {
        throw { statusCode: 400, message: `${key} must be a non-negative number` };
      }
    }
    const bounds = BOUNDED_SETTINGS[key];
    if (bounds) {
      if (value.trim() === '') continue;
      const n = parseFloat(value);
      if (!Number.isFinite(n) || n < bounds.min || n > bounds.max) {
        throw { statusCode: 400, message: `${key} must be between ${bounds.min} and ${bounds.max}` };
      }
    }
    // Crypto can only be switched ON where the server can actually mint a
    // BTCPay invoice. Without this, ticking the box on a deployment that has
    // no BTCPAY_* env vars shows customers a Bitcoin option that reserves
    // their stock and then 503s — a live checkout wired to nothing.
    // Switching it OFF is always allowed, whatever the server config.
    // The hosted manual checkout's whole config travels as one JSON setting.
    // Parse it here so a malformed save is refused with the field that is
    // wrong, instead of being stored and silently replaced by defaults on read.
    if (key === MANUALPAY_CONFIG_KEY) {
      try {
        checkoutConfigSchema.parse(JSON.parse(value));
      } catch (err) {
        const issue = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues?.[0];
        throw {
          statusCode: 400,
          message: issue ? `Manual payment config: ${issue.path.join('.')} — ${issue.message}` : 'Manual payment config is not valid JSON',
        };
      }
    }
    // Same shape of guard as crypto below: switching the hosted checkout ON
    // with no enabled method would send customers to a page that can only
    // say "contact us". The config being saved in the same request counts.
    if (key === MANUALPAY_ENABLED_KEY && value === 'true') {
      const cfg = data[MANUALPAY_CONFIG_KEY] ? checkoutConfigSchema.safeParse(JSON.parse(data[MANUALPAY_CONFIG_KEY])) : null;
      const methods = cfg?.success ? cfg.data.methods : (await loadManualPayConfig(fastify)).methods;
      if (!methods.some((m) => m.enabled)) {
        throw { statusCode: 400, message: 'Enable at least one manual payment method (DuitNow QR, bank transfer or a payment link) before switching manual payment on.' };
      }
    }
    if (key === 'crypto_payment_enabled' && value === 'true' && !getActiveGateway('btcpay')) {
      throw {
        statusCode: 400,
        message: 'BTCPay is not configured on this server. Set BTCPAY_URL, BTCPAY_API_KEY and BTCPAY_STORE_ID before enabling crypto payment.',
      };
    }
  }

  for (const [key, value] of Object.entries(data)) {
    await fastify.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  // Settings are baked into server-rendered pages — the shipping policy, the
  // FAQ, llms.txt and the product JSON-LD all read shipping fees and the East
  // Malaysia minimum through the 'products'-tagged fetch in
  // frontend/src/lib/server-api.ts. Without this ping those pages keep quoting
  // the old figures for up to an hour after a save, while checkout (a client
  // fetch) switches immediately — so the site would actively contradict itself
  // about what a customer owes. Fire-and-forget, like every other caller.
  notifyRevalidate();

  return getSettings(fastify);
}
