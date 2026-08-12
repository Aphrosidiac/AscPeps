import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getActiveGateway } from '../../utils/payment-gateway.js';

export async function getSettings(fastify: FastifyInstance) {
  const settings = await fastify.prisma.setting.findMany();
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}

const updateSettingsSchema = z.record(z.string(), z.string());

// Settings whose value must be a non-negative finite number (stored as a string).
const NUMERIC_SETTINGS = new Set(['shipping_fee', 'welcome_discount_days', 'welcome_discount_min_order']);

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

  return getSettings(fastify);
}
