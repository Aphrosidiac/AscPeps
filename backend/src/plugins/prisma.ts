import fp from 'fastify-plugin';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

const adapter = new PrismaPg(env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

export default fp(async (fastify: FastifyInstance) => {
  await prisma.$connect();
  fastify.decorate('prisma', prisma);
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
