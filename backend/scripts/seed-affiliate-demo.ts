/**
 * Local demo data for Ascend Affiliate — a LOCAL database only. Switches the
 * programme on and makes one approved affiliate with orders in every state
 * (paid, waiting for payment, part refunded) and one waiting for approval,
 * through the real checkout and admin paths. Safe to run twice: it removes
 * its own previous demo first.
 *
 *   npx tsx scripts/seed-affiliate-demo.ts
 *
 * Sign in at http://affiliate.localhost:3399 with
 *   demo-affiliate@example.test / affiliate-demo-1   (approved, has orders)
 *   demo-applicant@example.test / affiliate-demo-1   (waiting for approval)
 */
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyInstance } from 'fastify';
import { env } from '../src/config/env.js';
import { AFFILIATE_SETTING_KEYS, syncAffiliateOrders } from '../src/utils/affiliate.js';
import { createOrder } from '../src/modules/orders/orders.controller.js';
import { adminUpdateOrder } from '../src/modules/admin/admin-orders.controller.js';
import { adminUpdateAffiliate, joinProgramme } from '../src/modules/affiliates/affiliates.controller.js';

if (!/localhost|127\.0\.0\.1/.test(env.DATABASE_URL)) throw new Error('local databases only');
const prisma = new PrismaClient({ adapter: new PrismaPg(env.DATABASE_URL) });
const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const fastify = { prisma, log: quiet } as unknown as FastifyInstance;
const PASSWORD = 'affiliate-demo-1';

const set = (key: string, value: string) => prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
await set(AFFILIATE_SETTING_KEYS.enabled, 'true');
await set(AFFILIATE_SETTING_KEYS.signupBonusEnabled, 'true');

// Clear a previous demo.
for (const email of ['demo-affiliate@example.test', 'demo-applicant@example.test', 'demo-newcomer@example.test']) {
  const m = await prisma.member.findUnique({ where: { email }, include: { affiliate: true } });
  if (!m) continue;
  if (m.affiliate) {
    const orders = await prisma.order.findMany({ where: { affiliateId: m.affiliate.id }, select: { id: true } });
    const ids = orders.map((o) => o.id);
    const items = await prisma.orderItem.findMany({ where: { orderId: { in: ids } } });
    for (const i of items) if (i.quantity - i.preorderQty > 0) await prisma.productVariant.update({ where: { id: i.variantId }, data: { stock: { increment: i.quantity - i.preorderQty } } });
    await prisma.affiliateEntry.deleteMany({ where: { affiliateId: m.affiliate.id } });
    await prisma.affiliatePayout.deleteMany({ where: { affiliateId: m.affiliate.id } });
    await prisma.affiliateChangeRequest.deleteMany({ where: { affiliateId: m.affiliate.id } });
    await prisma.$executeRawUnsafe(`DELETE FROM email_outbox WHERE "orderId" = ANY($1)`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM payment_events WHERE "orderId" = ANY($1)`, ids);
    await prisma.$executeRawUnsafe(`DELETE FROM order_profit_shares WHERE "orderId" = ANY($1)`, ids);
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids }, parentItemId: { not: null } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await prisma.order.deleteMany({ where: { id: { in: ids } } });
    await prisma.affiliate.delete({ where: { id: m.affiliate.id } });
    await prisma.discountCode.delete({ where: { id: m.affiliate.discountCodeId } });
  }
  await prisma.member.delete({ where: { id: m.id } });
}

const hash = await bcrypt.hash(PASSWORD, 10);
const amir = await prisma.member.create({ data: { email: 'demo-affiliate@example.test', passwordHash: hash, displayName: 'Amir Hakim', emailVerified: true } });
const siti = await prisma.member.create({ data: { email: 'demo-applicant@example.test', passwordHash: hash, displayName: 'Siti Aminah', emailVerified: true } });
// Signed up, never joined: walks the onboarding (Onboarding.tsx).
await prisma.member.create({ data: { email: 'demo-newcomer@example.test', passwordHash: hash, displayName: 'Nur Aisyah', emailVerified: true } });

const a = await joinProgramme(fastify, { id: amir.id, email: amir.email }, { fullName: 'Amir Hakim', phone: '0123456789', channel: 'instagram.com/amir.lifts', code: 'AH87123', acceptTerms: true });
await joinProgramme(fastify, { id: siti.id, email: siti.email }, { fullName: 'Siti Aminah', phone: '0198765432', channel: 'TikTok @siti.fit', code: 'SA52904', acceptTerms: true });
const id = (a.affiliate as unknown as { id: string }).id;
await adminUpdateAffiliate(fastify, id, { status: 'ACTIVE' }, 'seed');
await prisma.affiliate.update({ where: { id }, data: { bankName: 'Maybank', bankAccountName: 'AMIR HAKIM', bankAccountNumber: '164012345678' } });

const variants = await prisma.productVariant.findMany({
  where: { stock: { gt: 20 }, active: true, product: { active: true, addOnOnly: false, noShipping: false } },
  select: { id: true },
  take: 3,
  orderBy: { stock: 'desc' },
});
const buyers = [
  ['Nurul Izzah', '0171112233', 2, 'paid'],
  ['Daniel Lee', '0162223344', 1, 'paid'],
  ['Farah Nadia', '0133334455', 3, 'part'],
  ['Kumar Raj', '0144445566', 1, 'unpaid'],
] as const;
for (const [i, [name, phone, qty, state]] of buyers.entries()) {
  const r: any = await createOrder(fastify, {
    customerName: name, phone, email: `${phone}@example.test`, address: '1 Jalan Demo', city: 'Shah Alam', state: 'Selangor', postcode: '40000',
    paymentMethod: 'WHATSAPP', discountCode: 'AH87123', items: [{ variantId: variants[i % variants.length].id, quantity: qty }],
  });
  const o = r.order ?? r;
  if (state !== 'unpaid') await adminUpdateOrder(fastify, o.id, { paymentStatus: 'PAID' }, 'seed');
  if (state === 'part') await adminUpdateOrder(fastify, o.id, { refundedAmount: Math.round(o.total / 3) }, 'seed');
}
await syncAffiliateOrders(prisma);
console.log('demo ready: AH87123 (active, 4 orders), SA52904 (waiting for approval)');
await prisma.$disconnect();
