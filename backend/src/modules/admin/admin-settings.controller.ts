import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export async function getSettings(fastify: FastifyInstance) {
  const settings = await fastify.prisma.setting.findMany();
  return Object.fromEntries(settings.map((s) => [s.key, s.value]));
}

const updateSettingsSchema = z.record(z.string(), z.string());

export async function updateSettings(fastify: FastifyInstance, body: unknown) {
  const data = updateSettingsSchema.parse(body);

  for (const [key, value] of Object.entries(data)) {
    await fastify.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  return getSettings(fastify);
}
