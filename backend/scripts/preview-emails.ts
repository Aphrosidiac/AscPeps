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
 * Asset URLs are rewritten to localhost so the preview picks up images that are
 * not deployed yet — see ASSET_REWRITES. Preview-only; nothing here ships.
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
import { renderCampaign } from '../src/emails/campaign.js';

// Same driver adapter the app uses (src/plugins/prisma.ts) — Prisma 7 has no
// implicit datasource, so a bare `new PrismaClient()` throws here.
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });
const outDir = path.resolve(process.argv[2] || 'email-preview');

// The frontend dev server serves /images; the backend serves /uploads.
const ASSET_REWRITES: [RegExp, string][] = [
  [/https:\/\/ascendpeptides\.my\/images\//g, 'http://localhost:3099/images/'],
  [/https:\/\/ascendpeptides\.my\/uploads\//g, 'http://localhost:3105/uploads/'],
];
const localise = (html: string) =>
  ASSET_REWRITES.reduce((acc, [re, to]) => acc.replace(re, to), html);

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
  const order = await prisma.order.findFirst({
    where: { items: { some: {} } },
    include: ORDER_INCLUDE,
    orderBy: { items: { _count: 'desc' } },
  });
  if (!order) throw new Error('no orders in this database — nothing to render');

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

  const pages: [string, { subject: string; html: string }][] = [
    ['order-confirmation', renderOrderConfirmation(order, 'https://example.test/pay', settings)],
    ['order-confirmation-whatsapp', renderOrderConfirmation({ ...order, paymentMethod: 'WHATSAPP' }, undefined, settings)],
    ['payment-receipt', renderPaymentReceipt(order, order.updatedAt, settings)],
    ['abandoned-checkout', renderAbandonedCheckout(order, 'https://example.test/pay', settings)],
    ['welcome', renderWelcome(discount, 'https://example.test/unsub', settings)],
    ['welcome-no-discount', renderWelcome(null, 'https://example.test/unsub', settings)],
    ['verify-email', renderVerifyEmail('Fakhrul', 'https://example.test/verify', settings)],
    [
      'campaign',
      renderCampaign(
        {
          subject: 'Retatrutide is back in stock',
          preheader: null,
          body: 'The RT10 and RT20 vials landed this morning, both from the same batch as the COA published last week.\n\nStock is limited to what came in — we are not taking backorders on this one.',
          ctaLabel: 'View the batch',
          ctaUrl: 'https://example.test/products/retatrutide',
        },
        'https://example.test/unsub',
        settings
      ),
    ],
  ];

  const index: string[] = [];
  for (const [name, { subject, html }] of pages) {
    const bytes = Buffer.byteLength(html, 'utf8');
    // Gmail clips the HTML source at ~102KB; anything past that loses the
    // footer, the unsubscribe link and often the tracking pixel.
    const flag = bytes > 102_000 ? '  ** OVER GMAIL CLIP LIMIT **' : '';
    console.log(`${name.padEnd(30)} ${(bytes / 1024).toFixed(1).padStart(6)}KB   ${subject}${flag}`);
    await writeFile(path.join(outDir, `${name}.html`), localise(html));
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
