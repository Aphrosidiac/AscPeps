import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export async function getSettings(fastify: FastifyInstance) {
  const settings = await fastify.prisma.setting.findMany();
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}

const updateSettingsSchema = z.record(z.string(), z.string());

// Settings whose value must be a non-negative finite number (stored as a string).
const NUMERIC_SETTINGS = new Set(['shipping_fee']);

export async function updateSettings(fastify: FastifyInstance, body: unknown) {
  const data = updateSettingsSchema.parse(body);

  for (const [key, value] of Object.entries(data)) {
    if (NUMERIC_SETTINGS.has(key)) {
      const n = parseFloat(value);
      if (!Number.isFinite(n) || n < 0) {
        throw { statusCode: 400, message: `${key} must be a non-negative number` };
      }
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
