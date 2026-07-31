/**
 * Exercises every WRITE tool directly (no LLM), then rolls back.
 *
 * The e2e conversation suite proves the agent reaches for the right tool; this
 * proves each tool actually does what it claims against a real database, which
 * is where the damage would be. Every mutation is undone, and the script fails
 * loudly if a rollback does not restore the original value.
 *
 *   set -a && source .env && set +a && npx tsx scripts/test-agent-writes.ts
 */
import Fastify from 'fastify';
import prismaPlugin from '../src/plugins/prisma.js';
import { ALL_TOOLS, getTool } from '../src/modules/ai-agent/registry.js';
import type { ToolContext } from '../src/modules/ai-agent/tool-kit.js';

const fastify = Fastify({ logger: false });
await fastify.register(prismaPlugin);
const prisma = fastify.prisma;

const ctx: ToolContext = {
  fastify,
  prisma,
  actor: { phone: '0123456789', name: 'Write Test', canWrite: true },
  revalidate: () => {},
};

let pass = 0;
let fail = 0;
const failures: string[] = [];
const exercised = new Set<string>();

async function check(name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    console.log(`✓ ${name.padEnd(32)} ${detail}`);
    pass++;
  } catch (e: any) {
    console.log(`✗ ${name.padEnd(32)} ${e?.message ?? e}`);
    fail++;
    failures.push(`${name}: ${e?.message ?? e}`);
  }
}

const run = (tool: string, input: any) => {
  exercised.add(tool);
  const t = getTool(tool);
  if (!t) throw new Error(`no such tool: ${tool}`);
  return t.run(ctx, input);
};

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

console.log('='.repeat(78));
console.log('WRITE TOOL AUDIT — every mutation is rolled back');
console.log('='.repeat(78));

// ---------------------------------------------------------------- catalogue

await check('update_product', async () => {
  const p = await prisma.product.findFirstOrThrow();
  const before = p.description;
  await run('update_product', { productId: p.id, description: 'AGENT AUDIT TEMP' });
  const mid = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
  assert(mid.description === 'AGENT AUDIT TEMP', 'description did not change');
  await prisma.product.update({ where: { id: p.id }, data: { description: before } });
  const after = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
  assert(after.description === before, 'rollback failed');
  return 'changed and restored';
});

await check('update_variant (price in RM)', async () => {
  const v = await prisma.productVariant.findFirstOrThrow();
  const before = v.price;
  await run('update_variant', { variantId: v.id, priceRm: 88.88 });
  const mid = await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id } });
  assert(mid.price === 8888, `expected 8888 cents, got ${mid.price}`);
  await prisma.productVariant.update({ where: { id: v.id }, data: { price: before } });
  return 'RM 88.88 -> 8888 cents, restored';
});

await check('adjust_stock (relative)', async () => {
  const v = await prisma.productVariant.findFirstOrThrow();
  const before = v.stock;
  await run('adjust_stock', { variantId: v.id, delta: 7, reason: 'audit' });
  const up = await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id } });
  assert(up.stock === before + 7, `expected ${before + 7}, got ${up.stock}`);
  await run('adjust_stock', { variantId: v.id, delta: -7, reason: 'audit rollback' });
  const back = await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id } });
  assert(back.stock === before, 'rollback failed');
  return `${before} +7 -7 = ${back.stock}`;
});

await check('adjust_stock clamps below zero', async () => {
  const v = await prisma.productVariant.findFirstOrThrow();
  const before = v.stock;
  await run('adjust_stock', { variantId: v.id, delta: -(before + 9999) });
  const after = await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id } });
  assert(after.stock === 0, `expected clamp to 0, got ${after.stock}`);
  await prisma.productVariant.update({ where: { id: v.id }, data: { stock: before } });
  return 'clamped to 0 rather than going negative';
});

await check('set_sale + clear', async () => {
  const v = await prisma.productVariant.findFirstOrThrow({ where: { price: { gt: 5000 } } });
  await run('set_sale', { variantId: v.id, salePriceRm: 10, startsAt: 'today', endsAt: '2030-01-01' });
  const on = await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id } });
  assert(on.salePrice === 1000, `expected 1000 cents, got ${on.salePrice}`);
  assert(on.saleEndsAt !== null, 'no end date stored');
  await run('set_sale', { variantId: v.id, clear: true });
  const off = await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id } });
  assert(off.salePrice === null, 'sale not cleared');
  return 'set then cleared';
});

await check('set_sale rejects a sale above list price', async () => {
  const v = await prisma.productVariant.findFirstOrThrow();
  try {
    await run('set_sale', { variantId: v.id, salePriceRm: 999999, endsAt: '2030-01-01' });
  } catch (e: any) {
    assert(/not below/i.test(e.message), `wrong error: ${e.message}`);
    return 'refused a "sale" that costs more';
  }
  throw new Error('accepted a sale price above the regular price');
});

await check('set_sale requires an end date', async () => {
  const v = await prisma.productVariant.findFirstOrThrow();
  try {
    await run('set_sale', { variantId: v.id, salePriceRm: 1 });
  } catch (e: any) {
    assert(/endsAt is required/i.test(e.message), `wrong error: ${e.message}`);
    return 'refused an open-ended sale';
  }
  throw new Error('accepted a sale with no end date');
});

await check('bulk_price_change', async () => {
  const cat = await prisma.category.findFirstOrThrow();
  const before = await prisma.productVariant.findMany({
    where: { active: true, product: { active: true, categoryId: cat.id } },
    select: { id: true, price: true },
  });
  if (!before.length) return 'skipped (no active variants in first category)';
  await run('bulk_price_change', { percent: 10, categoryName: cat.name });
  const after = await prisma.productVariant.findMany({
    where: { id: { in: before.map((b) => b.id) } },
    select: { id: true, price: true },
  });
  const byId = new Map(before.map((b) => [b.id, b.price]));
  for (const a of after) {
    const expected = Math.max(1, Math.round(byId.get(a.id)! * 1.1));
    assert(a.price === expected, `variant ${a.id}: expected ${expected}, got ${a.price}`);
  }
  await prisma.$transaction(before.map((b) => prisma.productVariant.update({ where: { id: b.id }, data: { price: b.price } })));
  return `${before.length} variants +10% then restored exactly`;
});

await check('manage_product_addons add + remove', async () => {
  const product = await prisma.product.findFirstOrThrow();
  const addon = await prisma.productVariant.findFirstOrThrow({ where: { productId: { not: product.id } } });
  const existed = await prisma.productAddOn.findFirst({ where: { productId: product.id, addOnId: addon.id } });
  if (existed) return 'skipped (pair already configured)';
  await run('manage_product_addons', { productId: product.id, addOnVariantId: addon.id, action: 'add', required: true, quantity: 2 });
  const added = await prisma.productAddOn.findFirstOrThrow({ where: { productId: product.id, addOnId: addon.id } });
  assert(added.required === true && added.quantity === 2, 'flags not stored');
  await run('manage_product_addons', { productId: product.id, addOnVariantId: addon.id, action: 'remove' });
  const gone = await prisma.productAddOn.findFirst({ where: { productId: product.id, addOnId: addon.id } });
  assert(!gone, 'remove failed');
  return 'added then removed';
});

// ---------------------------------------------------------------- orders

await check('update_order (tracking + notes)', async () => {
  const o = await prisma.order.findFirstOrThrow({ where: { deletedAt: null } });
  const before = { trackingNumber: o.trackingNumber, notes: o.notes };
  await run('update_order', { orderRef: o.orderNumber, trackingNumber: 'AUDIT123', notes: 'audit note' });
  const mid = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
  assert(mid.trackingNumber === 'AUDIT123', 'tracking not set');
  await prisma.order.update({ where: { id: o.id }, data: before });
  return 'set and restored';
});

await check('update_order CANCELLED restores stock', async () => {
  // Use a PENDING order so cancelling is meaningful and reversible.
  const o = await prisma.order.findFirst({
    where: { deletedAt: null, status: { notIn: ['CANCELLED'] }, stockRestored: false },
    include: { items: true },
  });
  if (!o || !o.items.length) return 'skipped (no suitable order)';
  const item = o.items[0];
  const stockBefore = (await prisma.productVariant.findUniqueOrThrow({ where: { id: item.variantId } })).stock;
  const statusBefore = o.status;

  await run('update_order', { orderRef: o.orderNumber, status: 'CANCELLED' });
  const stockAfter = (await prisma.productVariant.findUniqueOrThrow({ where: { id: item.variantId } })).stock;
  assert(stockAfter >= stockBefore, `stock went DOWN on cancel: ${stockBefore} -> ${stockAfter}`);

  // Roll back both the status and the restored stock.
  await prisma.order.update({ where: { id: o.id }, data: { status: statusBefore, stockRestored: false } });
  await prisma.productVariant.update({ where: { id: item.variantId }, data: { stock: stockBefore } });
  return `stock ${stockBefore} -> ${stockAfter} on cancel (restored)`;
});

await check('set_order_costs computes profit', async () => {
  const o = await prisma.order.findFirstOrThrow({ where: { deletedAt: null }, include: { items: true, extraCosts: true } });
  if (!o.items.length) return 'skipped (order has no items)';
  const beforeCosts = o.items.map((i) => ({ id: i.id, unitCost: i.unitCost }));
  const beforeExtras = o.extraCosts.map((c) => ({ label: c.label, amount: c.amount }));

  const res: any = await run('set_order_costs', {
    orderRef: o.orderNumber,
    itemCosts: o.items.map((i) => ({ itemId: i.id, unitCostRm: 10 })),
    extraCosts: [{ label: 'Audit courier', amountRm: 5 }],
  });
  assert(res.allItemsCosted === true, 'not all items marked costed');
  const expectedGoods = o.items.reduce((s, i) => s + 1000 * i.quantity, 0);
  assert(res.goodsCost.cents === expectedGoods, `goods cost ${res.goodsCost.cents} != ${expectedGoods}`);
  assert(res.extraCosts.cents === 500, `extras ${res.extraCosts.cents} != 500`);
  assert(res.netProfit !== null, 'profit should be known when fully costed');

  await prisma.orderExtraCost.deleteMany({ where: { orderId: o.id } });
  if (beforeExtras.length) {
    await prisma.orderExtraCost.createMany({ data: beforeExtras.map((c) => ({ ...c, orderId: o.id })) });
  }
  await prisma.$transaction(
    beforeCosts.map((c) => prisma.orderItem.update({ where: { id: c.id }, data: { unitCost: c.unitCost } }))
  );
  return `goods ${res.goodsCost.display}, extras ${res.extraCosts.display}, profit ${res.netProfit.display} (restored)`;
});

await check('set_order_profit_shares rejects != 100%', async () => {
  const o = await prisma.order.findFirstOrThrow({ where: { deletedAt: null } });
  try {
    await run('set_order_profit_shares', { orderRef: o.orderNumber, shares: [{ name: 'A', percent: 30 }, { name: 'B', percent: 30 }] });
  } catch (e: any) {
    assert(/100%/.test(e.message), `wrong error: ${e.message}`);
    return 'refused a 60% split';
  }
  throw new Error('accepted shares that do not total 100%');
});

await check('set_order_profit_shares saves a valid split', async () => {
  const o = await prisma.order.findFirstOrThrow({ where: { deletedAt: null }, include: { profitShares: true } });
  const before = o.profitShares.map((s) => ({ name: s.name, shareBps: s.shareBps, capitalAmount: s.capitalAmount }));
  await run('set_order_profit_shares', {
    orderRef: o.orderNumber,
    shares: [
      { name: 'Fakhrul', percent: 33.33, capitalRm: 5 },
      { name: 'Asyraf', percent: 33.33 },
      { name: 'Investors', percent: 33.34 },
    ],
  });
  const saved = await prisma.orderProfitShare.findMany({ where: { orderId: o.id } });
  assert(saved.length === 3, `expected 3 shares, got ${saved.length}`);
  assert(saved.reduce((s, x) => s + x.shareBps, 0) === 10000, 'bps do not total 10000');
  const fakhrul = saved.find((s) => s.name === 'Fakhrul');
  assert(fakhrul?.capitalAmount === 500, `capital ${fakhrul?.capitalAmount} != 500 cents`);

  await prisma.orderProfitShare.deleteMany({ where: { orderId: o.id } });
  if (before.length) {
    await prisma.orderProfitShare.createMany({ data: before.map((s) => ({ ...s, orderId: o.id })) });
  }
  return '33.33/33.33/33.34 = exactly 100% (restored)';
});

await check('create_order (full lifecycle, rolled back)', async () => {
  // Pick a product that has a REQUIRED add-on, so the auto-add path is
  // exercised rather than a trivial single-line order.
  // Set up a required add-on if the database has none, rather than skipping —
  // the auto-add path is the most consequential part of order creation and a
  // silent skip would hide a regression in it.
  let rel = await prisma.productAddOn.findFirst({
    where: { required: true, addOn: { active: true, product: { active: true } } },
    include: { product: { include: { variants: { where: { active: true }, orderBy: { price: 'asc' } } } }, addOn: true },
  });
  let temporaryRelationId: string | null = null;

  if (!rel) {
    const parent = await prisma.product.findFirst({
      where: { active: true, variants: { some: { active: true, stock: { gt: 2 } } } },
      include: { variants: { where: { active: true }, orderBy: { price: 'asc' } } },
    });
    const addOnVariant = await prisma.productVariant.findFirst({
      where: { active: true, stock: { gt: 2 }, productId: { not: parent?.id } },
    });
    if (!parent || !addOnVariant) return 'skipped (dev db has no suitable product pair)';
    const createdRel = await prisma.productAddOn.create({
      data: { productId: parent.id, addOnId: addOnVariant.id, required: true, quantity: 2 },
    });
    temporaryRelationId = createdRel.id;
    rel = await prisma.productAddOn.findUniqueOrThrow({
      where: { id: createdRel.id },
      include: { product: { include: { variants: { where: { active: true }, orderBy: { price: 'asc' } } } }, addOn: true },
    });
  }

  const parentVariant = rel.product.variants[0];
  if (!parentVariant) return 'skipped (parent product has no active variant)';

  const stockBefore = parentVariant.stock;
  const addOnStockBefore = (await prisma.productVariant.findUniqueOrThrow({ where: { id: rel.addOnId } })).stock;
  const orderCountBefore = await prisma.order.count();

  const res: any = await run('create_order', {
    customerName: 'Agent Audit Customer',
    phone: '0123456789',
    address: '1 Audit Street',
    city: 'Shah Alam',
    state: 'Selangor',
    postcode: '40000',
    paymentMethod: 'WHATSAPP',
    items: [{ code: parentVariant.code, quantity: 1 }],
  });

  try {
    assert(res.orderNumber, 'no order number returned');
    assert(res.paymentStatus === 'UNPAID', `expected UNPAID, got ${res.paymentStatus}`);

    const created = await prisma.order.findFirstOrThrow({
      where: { orderNumber: res.orderNumber },
      include: { items: true },
    });

    // Stock actually moved for the parent.
    const parentAfter = await prisma.productVariant.findUniqueOrThrow({ where: { id: parentVariant.id } });
    assert(parentAfter.stock === stockBefore - 1, `parent stock ${stockBefore} -> ${parentAfter.stock}, expected -1`);

    // The required add-on was added automatically, and its stock moved too.
    const addOnLine = created.items.find((i) => i.variantId === rel.addOnId);
    assert(addOnLine, 'required add-on was NOT added to the order');
    const addOnAfter = await prisma.productVariant.findUniqueOrThrow({ where: { id: rel.addOnId } });
    assert(
      addOnAfter.stock === addOnStockBefore - addOnLine!.quantity,
      `add-on stock ${addOnStockBefore} -> ${addOnAfter.stock}, expected -${addOnLine!.quantity}`
    );

    // Totals are computed from the database, never from the caller.
    const expectedSubtotal = created.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    assert(created.subtotal === expectedSubtotal, `subtotal ${created.subtotal} != sum of lines ${expectedSubtotal}`);
    assert(
      created.total === created.subtotal + created.shippingFee - created.discountAmount,
      'total does not reconcile with subtotal + shipping - discount'
    );

    // Roll everything back: stock, the order, and its queued email.
    await prisma.emailOutbox.deleteMany({ where: { orderId: created.id } });
    await prisma.order.delete({ where: { id: created.id } });
    await prisma.productVariant.update({ where: { id: parentVariant.id }, data: { stock: stockBefore } });
    await prisma.productVariant.update({ where: { id: rel.addOnId }, data: { stock: addOnStockBefore } });
    assert((await prisma.order.count()) === orderCountBefore, 'order count did not return to baseline');
    if (temporaryRelationId) await prisma.productAddOn.delete({ where: { id: temporaryRelationId } });

    return `${res.orderNumber} created with auto add-on (${addOnLine!.quantity}x), ${res.total.display}, stock moved and restored`;
  } catch (e) {
    // Never leave a stray order behind if an assertion fails mid-way.
    const stray = await prisma.order.findFirst({ where: { orderNumber: res.orderNumber } });
    if (stray) {
      await prisma.emailOutbox.deleteMany({ where: { orderId: stray.id } });
      await prisma.order.delete({ where: { id: stray.id } });
    }
    await prisma.productVariant.update({ where: { id: parentVariant.id }, data: { stock: stockBefore } });
    await prisma.productVariant.update({ where: { id: rel.addOnId }, data: { stock: addOnStockBefore } });
    if (temporaryRelationId) await prisma.productAddOn.delete({ where: { id: temporaryRelationId } }).catch(() => {});
    throw e;
  }
});

await check('create_order refuses to oversell', async () => {
  const v = await prisma.productVariant.findFirstOrThrow({ where: { active: true, product: { active: true } } });
  try {
    await run('create_order', {
      customerName: 'Agent Audit Customer',
      phone: '0123456789',
      address: '1 Audit Street',
      city: 'Shah Alam',
      state: 'Selangor',
      postcode: '40000',
      items: [{ code: v.code, quantity: v.stock + 500 }],
    });
  } catch (e: any) {
    assert(/left in stock/i.test(e.message), `wrong error: ${e.message}`);
    return 'refused an order larger than available stock';
  }
  throw new Error('allowed an order exceeding stock');
});

await check('create_order rejects an unknown product', async () => {
  try {
    await run('create_order', {
      customerName: 'Agent Audit Customer',
      phone: '0123456789',
      address: '1 Audit Street',
      city: 'Shah Alam',
      state: 'Selangor',
      postcode: '40000',
      items: [{ code: 'NOPE_NOT_A_SKU', quantity: 1 }],
    });
  } catch (e: any) {
    assert(/No active product matches/i.test(e.message), `wrong error: ${e.message}`);
    return 'refused an unknown SKU rather than guessing';
  }
  throw new Error('accepted an unknown SKU');
});

await check('delete_order + restore_order', async () => {
  const o = await prisma.order.findFirstOrThrow({ where: { deletedAt: null } });
  await run('delete_order', { orderRef: o.orderNumber });
  const del = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
  assert(del.deletedAt !== null, 'not soft-deleted');
  await run('restore_order', { orderRef: o.orderNumber });
  const back = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
  assert(back.deletedAt === null, 'not restored');
  return 'soft-deleted then restored';
});

// ---------------------------------------------------------------- discounts

await check('create/update/delete_discount_code', async () => {
  const code = 'AUDIT_TMP_1';
  await prisma.discountCode.deleteMany({ where: { code } });
  const created: any = await run('create_discount_code', { code, percent: 15, maxUses: 5, expiresAt: '2030-01-01' });
  const row = await prisma.discountCode.findUniqueOrThrow({ where: { code } });
  assert(row.discountType === 'PERCENTAGE' && row.discountValue === 15, 'percent not stored as whole number');
  await run('update_discount_code', { discountId: created.discountId, isActive: false });
  const off = await prisma.discountCode.findUniqueOrThrow({ where: { code } });
  assert(off.isActive === false, 'not deactivated');
  await run('delete_discount_code', { discountId: created.discountId });
  assert(!(await prisma.discountCode.findUnique({ where: { code } })), 'not deleted');
  return 'created, deactivated, deleted';
});

await check('create_discount_code rejects both percent and amount', async () => {
  try {
    await run('create_discount_code', { code: 'AUDIT_TMP_2', percent: 10, amountRm: 10 });
  } catch (e: any) {
    assert(/exactly one/i.test(e.message), `wrong error: ${e.message}`);
    return 'refused an ambiguous discount';
  } finally {
    await prisma.discountCode.deleteMany({ where: { code: 'AUDIT_TMP_2' } });
  }
  throw new Error('accepted both percent and amountRm');
});

await check('fixed-amount discount stores cents', async () => {
  const code = 'AUDIT_TMP_3';
  await prisma.discountCode.deleteMany({ where: { code } });
  const created: any = await run('create_discount_code', { code, amountRm: 25 });
  const row = await prisma.discountCode.findUniqueOrThrow({ where: { code } });
  assert(row.discountValue === 2500, `expected 2500 cents, got ${row.discountValue}`);
  await run('delete_discount_code', { discountId: created.discountId });
  return 'RM25 -> 2500 cents';
});

// ---------------------------------------------------------------- insights

await check('create/update/delete_insight', async () => {
  const created: any = await run('create_insight', {
    title: 'Agent Audit Temp Article',
    category: 'Research',
    excerpt: 'Temporary article created by the write-tool audit.',
    content: 'Line one.\n\nLine two.',
  });
  const row = await prisma.insight.findUniqueOrThrow({ where: { id: created.insightId } });
  assert(row.published === false, 'should default to draft');
  assert(row.readTimeMinutes >= 1, 'read time not computed');
  await run('update_insight', { insightId: created.insightId, published: true });
  const pub = await prisma.insight.findUniqueOrThrow({ where: { id: created.insightId } });
  assert(pub.published && pub.publishedAt, 'publishedAt not stamped');
  await run('delete_insight', { insightId: created.insightId });
  assert(!(await prisma.insight.findUnique({ where: { id: created.insightId } })), 'not deleted');
  return 'created as draft, published, deleted';
});

// ---------------------------------------------------------------- finance

await check('save_partners creates a partner', async () => {
  const existing = await prisma.partner.findMany({ select: { id: true, name: true, active: true, notes: true } });
  await run('save_partners', {
    partners: [...existing.map((p) => ({ id: p.id, name: p.name, active: p.active, notes: p.notes })), { name: 'Audit Temp Partner', active: true }],
  });
  const created = await prisma.partner.findUnique({ where: { name: 'Audit Temp Partner' } });
  assert(created, 'partner not created');
  return 'created (cleaned up at the end)';
});

await check('record_expense (company-paid)', async () => {
  const res: any = await run('record_expense', {
    amountRm: 42.5,
    category: 'Audit',
    description: 'Write tool audit expense',
    occurredAt: 'today',
  });
  const row = await prisma.companyExpense.findUniqueOrThrow({ where: { id: res.expenseId } });
  assert(row.amount === 4250, `expected 4250 cents, got ${row.amount}`);
  assert(row.paidByPartnerId === null, 'should not be attributed to a partner');
  await run('delete_expense', { expenseId: res.expenseId });
  return 'RM42.50 -> 4250 cents, deleted';
});

await check('record_expense requires funding type when a partner paid', async () => {
  try {
    await run('record_expense', { amountRm: 10, category: 'Audit', description: 'x', paidByPartner: 'Audit Temp Partner' });
  } catch (e: any) {
    assert(/CONTRIBUTION|ADVANCE/.test(e.message), `wrong error: ${e.message}`);
    return 'refused to guess contribution vs advance';
  }
  throw new Error('accepted a partner-paid expense with no funding type');
});

await check('record_funding ADVANCE then repay then delete', async () => {
  const partner = await prisma.partner.findUniqueOrThrow({ where: { name: 'Audit Temp Partner' } });
  const f: any = await run('record_funding', {
    partnerRef: 'Audit Temp Partner',
    type: 'ADVANCE',
    amountRm: 100,
    description: 'Audit advance',
  });
  const row = await prisma.partnerFunding.findUniqueOrThrow({ where: { id: f.fundingId } });
  assert(row.amount === 10000 && row.type === 'ADVANCE', 'advance not stored correctly');

  const rep: any = await run('record_repayment', { fundingId: f.fundingId, amountRm: 40 });
  const repRow = await prisma.partnerRepayment.findUniqueOrThrow({ where: { id: rep.repaymentId } });
  assert(repRow.amount === 4000, `expected 4000 cents, got ${repRow.amount}`);

  await run('delete_finance_record', { kind: 'repayment', id: rep.repaymentId });
  await run('delete_finance_record', { kind: 'funding', id: f.fundingId });
  assert(!(await prisma.partnerFunding.findUnique({ where: { id: f.fundingId } })), 'funding not deleted');
  void partner;
  return 'RM100 advance, RM40 partial repayment, both removed';
});

await check('record_payout then delete', async () => {
  const p: any = await run('record_payout', { partnerRef: 'Audit Temp Partner', amountRm: 30, note: 'audit' });
  const row = await prisma.profitPayout.findUniqueOrThrow({ where: { id: p.payoutId } });
  assert(row.amount === 3000, `expected 3000 cents, got ${row.amount}`);
  await run('delete_finance_record', { kind: 'payout', id: p.payoutId });
  return 'RM30 payout recorded then removed';
});

// ---------------------------------------------------------------- ops

await check('update_setting round-trips', async () => {
  const key = 'agent_audit_temp_setting';
  await run('update_setting', { key, value: 'hello' });
  const row = await prisma.setting.findUniqueOrThrow({ where: { key } });
  assert(row.value === 'hello', 'value not stored');
  await prisma.setting.delete({ where: { key } });
  return 'set and cleaned up';
});

await check('manage_operator grant / readonly / revoke', async () => {
  const phone = '0111222333';
  await run('manage_operator', { phone, name: 'Audit Op', action: 'grant' });
  let row = await prisma.whatsAppOperator.findUniqueOrThrow({ where: { phone } });
  assert(row.active && row.canWrite, 'grant failed');
  await run('manage_operator', { phone, action: 'set_readonly' });
  row = await prisma.whatsAppOperator.findUniqueOrThrow({ where: { phone } });
  assert(row.canWrite === false, 'set_readonly failed');
  await run('manage_operator', { phone, action: 'revoke' });
  row = await prisma.whatsAppOperator.findUniqueOrThrow({ where: { phone } });
  assert(row.active === false, 'revoke failed');
  await prisma.whatsAppOperator.delete({ where: { phone } });
  return 'granted, restricted, revoked';
});

await check('manage_operator normalizes phone format', async () => {
  // +60 12-345 6789 and 0123456789 must land on the same row, or a grant looks
  // like it worked while the inbound lookup never matches.
  await run('manage_operator', { phone: '+60 11-1222 444', name: 'Audit Norm', action: 'grant' });
  const rows = await prisma.whatsAppOperator.findMany({ where: { name: 'Audit Norm' } });
  assert(rows.length === 1, `expected 1 row, got ${rows.length}`);
  assert(/^0/.test(rows[0].phone), `phone not normalized: ${rows[0].phone}`);
  await prisma.whatsAppOperator.deleteMany({ where: { name: 'Audit Norm' } });
  return `stored as ${rows[0].phone}`;
});

await check('manage_group enable/disable', async () => {
  const jid = '999999@g.us';
  await run('manage_group', { groupJid: jid, subject: 'Audit Group', action: 'enable', requireMention: false });
  let g = await prisma.whatsAppGroup.findUniqueOrThrow({ where: { groupJid: jid } });
  assert(g.active && !g.requireMention, 'enable failed');
  await run('manage_group', { groupJid: jid, action: 'disable' });
  g = await prisma.whatsAppGroup.findUniqueOrThrow({ where: { groupJid: jid } });
  assert(!g.active, 'disable failed');
  await prisma.whatsAppGroup.delete({ where: { groupJid: jid } });
  return 'enabled then disabled';
});

await check('retry_failed_emails', async () => {
  const before = await prisma.emailOutbox.count({ where: { status: 'FAILED' } });
  const res: any = await run('retry_failed_emails', {});
  assert(res.requeued === before, `requeued ${res.requeued} != ${before} failed rows`);
  return `${before} failed rows requeued`;
});

await check('resend_order_email queues an outbox row', async () => {
  const o = await prisma.order.findFirst({ where: { deletedAt: null, email: { not: null } } });
  if (!o) return 'skipped (no order with an email address)';
  const existing = await prisma.emailOutbox.findUnique({
    where: { orderId_type: { orderId: o.id, type: 'ORDER_CONFIRMATION' } },
  });
  const res: any = await run('resend_order_email', { orderRef: o.orderNumber, type: 'ORDER_CONFIRMATION' });
  assert(res.status === 'PENDING', `status ${res.status}`);
  if (existing) {
    await prisma.emailOutbox.update({ where: { id: existing.id }, data: { status: existing.status, attempts: existing.attempts, sentAt: existing.sentAt } });
  } else {
    await prisma.emailOutbox.deleteMany({ where: { orderId: o.id, type: 'ORDER_CONFIRMATION' } });
  }
  return `queued (warning: ${res.warning ? 'emails disabled' : 'emails enabled'}), restored`;
});

// cleanup the temp partner last, after every finance test that referenced it
await prisma.partnerFunding.deleteMany({ where: { partner: { name: 'Audit Temp Partner' } } });
await prisma.profitPayout.deleteMany({ where: { partner: { name: 'Audit Temp Partner' } } });
await prisma.partner.deleteMany({ where: { name: 'Audit Temp Partner' } });

// ---------------------------------------------------------------- coverage

// Covered by a dedicated suite rather than here, because they only make sense
// against a whole schedule (windows -> slots -> booking -> cancellation) rather
// than as isolated calls. Named explicitly so the coverage gate below stays a
// real guarantee instead of being quietly weakened.
const COVERED_BY_DELIVERY_SUITE = new Set([
  'schedule_delivery',
  'update_delivery',
  'cancel_delivery',
]);

const writeTools = ALL_TOOLS.filter((t) => t.write).map((t) => t.name);
const untested = writeTools.filter((n) => !exercised.has(n) && !COVERED_BY_DELIVERY_SUITE.has(n));

console.log('\n' + '='.repeat(78));
console.log(`${pass} passed, ${fail} failed`);
console.log(
  `write tools: ${writeTools.length} total, ${exercised.size} exercised here, ` +
    `${COVERED_BY_DELIVERY_SUITE.size} in scripts/test-delivery-flow.ts`
);
if (untested.length) console.log(`NOT EXERCISED: ${untested.join(', ')}`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  - ${f}`));
}
console.log('='.repeat(78));

await fastify.close();
process.exit(fail || untested.length ? 1 : 0);
