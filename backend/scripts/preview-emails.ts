/**
 * Render every email template to an HTML file, using real rows from whatever
 * database DATABASE_URL points at.
 *
 * There is no other way to see these: the templates are only reachable through
 * the worker or a real send, and eyeballing the HTML source does not tell you
 * whether a nested table collapsed. Rendering the real thing against real
 * orders catches the layout bugs and the "this product has no photo" cases that
 * a hand-written fixture never would.
 *
 *   cd backend && set -a && source .env && set +a && npx tsx scripts/preview-emails.ts [outDir]
 *
 * Set EMAIL_ASSET_BASE_URL in backend/.env (see config/env.ts) to render
 * against local assets rather than the live site — the same switch the admin's
 * Template Preview uses, so this script and that page cannot disagree about
 * what the customer would see.
 */
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { renderOrderConfirmation } from '../src/emails/order-confirmation.js';
import { renderPaymentReceipt } from '../src/emails/payment-receipt.js';
import { renderAbandonedCheckout } from '../src/emails/abandoned-checkout.js';
import { renderWelcome } from '../src/emails/welcome.js';
import { renderVerifyEmail } from '../src/emails/verify-email.js';
import { renderSignupBonusEmail, renderResetPasswordEmail, renderConfirmNewEmail, renderEmailChangedNotice } from '../src/emails/account.js';
import { renderCampaign, loadCampaignProducts } from '../src/emails/campaign.js';
import { renderGroupBuySignup, renderGroupBuyStage } from '../src/emails/group-buy.js';
import { DEFAULT_STAGES } from '../src/utils/group-buy.js';
import { renderAffiliateEmail, affiliateMailSamples } from '../src/emails/affiliate.js';

// Same driver adapter the app uses (src/plugins/prisma.ts) — Prisma 7 has no
// implicit datasource, so a bare `new PrismaClient()` throws here.
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });
const outDir = path.resolve(process.argv[2] || 'email-preview');

const ORDER_INCLUDE = {
  items: { include: { variant: { select: { code: true, size: true, imageUrl: true, product: { select: { name: true } } } } } },
  discountCode: { select: { code: true } },
} as const;

async function main() {
  await mkdir(outDir, { recursive: true });

  const settings = Object.fromEntries(
    (await prisma.setting.findMany()).map((s) => [s.key, s.value])
  ) as Record<string, string>;

  // Prefer an order with several lines — a one-item order hides every alignment
  // problem the item table can have.
  const found = await prisma.order.findFirst({
    where: { items: { some: {} } },
    include: ORDER_INCLUDE,
    orderBy: { items: { _count: 'desc' } },
  });
  if (!found) throw new Error('no orders in this database — nothing to render');
  // Real lines and totals; a stand-in name and address so the preview reads like a customer's.
  const order = { ...found, customerName: 'Aisyah Rahman', address: '12, Jalan Telawi 3, Bangsar Baru', city: 'Kuala Lumpur', state: 'W.P. Kuala Lumpur', postcode: '59100' };

  const withPhoto = order.items.filter((i) => i.variant.imageUrl).length;
  console.log(
    `order ${order.orderNumber}: ${order.items.length} item(s), ${withPhoto} with a photo, ` +
      `${order.items.length - withPhoto} falling back to the placeholder tile`
  );

  const discount = {
    code: 'ASC-WELCOME-7QK2',
    percent: 10,
    expiresAt: new Date(Date.now() + 14 * 864e5),
    minOrderAmount: null,
  };

  const day = 864e5;
  const batch = { number: 3, slug: 'batch-03', title: 'Batch 03: Retatrutide and Tirzepatide', closesAt: new Date(Date.now() + 9 * day), shipEstimate: 'Week of 8 December' };
  const stages = DEFAULT_STAGES.map((st, i) => ({ ...st, doneAt: i < 4 ? new Date(Date.now() - (4 - i) * 3 * day).toISOString() : null, eta: i === 4 ? 'Around 2 December' : null, note: i === 3 ? 'Tracking from the supplier shows it clearing customs on Friday.' : null }));
  const productIds = (await prisma.product.findMany({ where: { active: true, variants: { some: { imageUrl: { not: null }, active: true } } }, select: { id: true }, take: 5, orderBy: { createdAt: 'desc' } })).map((p) => p.id);
  const featured = await loadCampaignProducts(prisma, productIds);

  const pages: [string, { subject: string; html: string }][] = [
    ['order-confirmation', renderOrderConfirmation({ ...order, paymentStatus: 'UNPAID' }, 'https://example.test/pay', settings)],
    ['order-confirmation-whatsapp', renderOrderConfirmation({ ...order, paymentMethod: 'WHATSAPP' }, undefined, settings)],
    ['order-confirmation-paid', renderOrderConfirmation({ ...order, paymentStatus: 'PAID' }, undefined, settings)],
    ['payment-receipt', renderPaymentReceipt(order, order.updatedAt, settings)],
    ['order-confirmation-preorder', renderOrderConfirmation({ ...order, paymentStatus: 'UNPAID', isPreorder: true, preorderLead: '10–14 days', items: order.items.map((it, i) => (i === 0 ? { ...it, preorderQty: it.quantity } : it)) }, 'https://example.test/pay', settings)],
    ['order-confirmation-bank', renderOrderConfirmation({ ...order, paymentStatus: 'UNPAID', paymentMethod: 'WHATSAPP', paymentGateway: 'manualpaygate' }, 'https://example.test/pay', settings)],
    ['abandoned-checkout', renderAbandonedCheckout(order, 'https://example.test/pay', settings)],
    ['welcome', renderWelcome(discount, 'https://example.test/unsub', settings)],
    ['welcome-no-discount', renderWelcome(null, 'https://example.test/unsub', settings)],
    ['verify-email', renderVerifyEmail('Fakhrul', 'https://example.test/verify', settings)],
    ['verify-email-bonus', renderVerifyEmail('Fakhrul', 'https://example.test/verify', settings, 10)],
    ['reset-password', renderResetPasswordEmail('Fakhrul', 'https://example.test/reset', settings)],
    ['confirm-new-email', renderConfirmNewEmail('Fakhrul', 'fakhrul@example.com', 'https://example.test/confirm', settings)],
    ['email-changed', renderEmailChangedNotice('Fakhrul', 'fakhrul@example.com', settings)],
    ['group-buy-signup', renderGroupBuySignup(batch, 'Fakhrul Fahmi', { code: 'GB03-7KQ2', type: 'PERCENTAGE', value: 5, expiresAt: batch.closesAt, minOrderAmount: null, scope: 'GROUP_BUY' }, settings)],
    ['group-buy-stage', renderGroupBuyStage(batch, stages, 'transit', { orderNumber: order.orderNumber, customerName: order.customerName, phone: '' }, settings)],
    ['signup-bonus', renderSignupBonusEmail('Fakhrul', 'WELCOME-9D5C7D', 10, 'https://example.test/products', settings)],
    [
      'campaign',
      renderCampaign(
        {
          name: 'Retatrutide restock',
          subject: 'Retatrutide is back in stock',
          preheader: null,
          body: 'The RT10 and RT20 vials landed this morning, both from the same batch as the COA published last week.\n\nStock is limited to what came in — we are not taking backorders on this one.',
          ctaLabel: 'View the batch',
          ctaUrl: 'https://example.test/products/retatrutide',
        },
        { unsubscribeUrl: 'https://example.test/unsub', settings }
      ),
    ],
    [
      'campaign-products',
      renderCampaign(
        {
          name: 'November restock',
          subject: 'New stock this week',
          preheader: null,
          badge: 'Restock',
          headline: 'New stock this week',
          subhead: 'Five compounds back on the shelf.',
          body: 'A fresh batch landed on Monday. Everything below ships the same day if you order before 3pm.',
          ctaLabel: 'Shop all products',
          ctaUrl: 'https://ascendpeptides.my/products',
        },
        { unsubscribeUrl: 'https://example.test/unsub', settings, products: featured }
      ),
    ],
    ...affiliateMailSamples().map(([name, mail]): [string, { subject: string; html: string }] => [
      `affiliate-${name}`,
      renderAffiliateEmail(
        mail,
        {
          name: 'Amir',
          code: 'AH87123',
          rate: '5%',
          customerDiscountPct: 5,
          portalUrl: 'https://affiliate.ascendpeptides.my',
          shareUrl: 'https://ascendpeptides.my/?ref=AH87123',
        },
        settings
      ),
    ]),
  ];

  const index: string[] = [];
  let problems = 0;
  for (const [name, { subject, html }] of pages) {
    const bytes = Buffer.byteLength(html, 'utf8');
    // Gmail clips the HTML source at ~102KB; anything past that loses the
    // footer, the unsubscribe link and often the tracking pixel.
    const flag = bytes > 102_000 ? '  ** OVER GMAIL CLIP LIMIT **' : '';
    console.log(`${name.padEnd(30)} ${(bytes / 1024).toFixed(1).padStart(6)}KB   ${subject}${flag}`);
    if (bytes > 102_000) problems++;
    await writeFile(path.join(outDir, `${name}.html`), html);
    index.push(
      `<li><a href="${name}.html">${name}</a> <span>${(bytes / 1024).toFixed(1)}KB</span><br><em>${subject}</em></li>`
    );
  }

  await writeFile(
    path.join(outDir, 'index.html'),
    `<style>body{font:15px/1.6 system-ui;margin:40px auto;max-width:640px}li{margin:0 0 14px}span{color:#888;font-size:12px}em{color:#666;font-size:13px}</style>
     <h1>Email previews</h1><ul>${index.join('')}</ul>`
  );
  console.log(`\nwrote ${pages.length + 1} files to ${outDir}`);
  if (problems) {
    console.log(`\n${problems} problem(s) found — see the !! lines above.`);
    process.exitCode = 1;
  } else {
    console.log('nothing over the Gmail clip limit.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
