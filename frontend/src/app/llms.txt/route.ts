import { formatPrice, formatShortDate } from '@/lib/utils';
import { getProductsServer, getSettingsServer, getInsightsServer } from '@/lib/server-api';
import { hasEastMinimum, eastFeeDiffers } from '@/lib/shipping-region';

const BASE_URL = 'https://ascendpeptides.my';

export const revalidate = 3600;

export async function GET() {
  const [{ data: products }, settings, { data: insights }] = await Promise.all([
    getProductsServer({ limit: 100 }),
    getSettingsServer(),
    getInsightsServer({ limit: 100 }),
  ]);

  const shippingFee = settings.shipping_fee || '';
  const freeShipping = !shippingFee || shippingFee === '0';
  const shippingSummaryClause = freeShipping ? 'free, fast shipping across Peninsular Malaysia' : 'fast shipping across Peninsular Malaysia';
  // East Malaysia terms, stated only when they actually differ from the
  // standard ones — same conditions the shipping page and FAQ use.
  const eastMinOrder = settings.east_malaysia_min_order || '';
  const eastShippingFee = settings.east_malaysia_shipping_fee || '';
  const eastHasMinimum = hasEastMinimum(eastMinOrder);
  const eastFeeClause = eastFeeDiffers(shippingFee, eastShippingFee)
    ? ` RM${eastShippingFee} to Sabah, Sarawak and Labuan.`
    : '';
  const shippingFactLine = freeShipping
    ? `- Currency: MYR. Shipping: free within Peninsular Malaysia.${eastFeeClause} Payment: bank transfer, FPX, credit/debit card.`
    : `- Currency: MYR. Shipping: flat RM${shippingFee} within Peninsular Malaysia.${eastFeeClause} Payment: bank transfer, FPX, credit/debit card.`;
  const marketFactLine = eastHasMinimum
    ? `- Market served: Malaysia only (Peninsular Malaysia, plus Sabah, Sarawak and Labuan on orders of RM${eastMinOrder} or more in products).`
    : '- Market served: Malaysia only (Peninsular Malaysia, Sabah, Sarawak and Labuan).';

  const productLines = products.map((p) => {
    const activePrices = p.variants.filter((v) => v.active).map((v) => v.price);
    const price = activePrices.length === 0
      ? ''
      : new Set(activePrices).size > 1
        ? `${formatPrice(Math.min(...activePrices))}–${formatPrice(Math.max(...activePrices))}`
        : formatPrice(activePrices[0]);
    const cat = p.category?.name ? ` — ${p.category.name}` : '';
    return `- [${p.name}](${BASE_URL}/products/${p.slug}): ${price}${cat}`;
  });

  const insightLines = insights.map((i) => {
    const date = i.publishedAt ?? i.createdAt;
    return `- [${i.title}](${BASE_URL}/insights/${i.slug}): ${i.category} — ${formatShortDate(date)}, by ${i.authorName}`;
  });

  const body = [
    '# Ascend MY — Research Peptides Malaysia',
    '',
    `> Ascend MY is Malaysia's premium research-peptide supplier. All compounds are lab-grade, manufactured to 99%+ purity and independently third-party tested (Certificate of Analysis available). Prices are in Malaysian Ringgit (MYR) with ${shippingSummaryClause}. No account required. All products are sold strictly for laboratory and research purposes only.`,
    '',
    '## Key pages',
    `- [Shop all peptides](${BASE_URL}/products): Full catalog with live MYR pricing and stock`,
    `- [Insights](${BASE_URL}/insights): Peptide research commentary and product updates, written by Asywa, Founder & CEO of Ascend MY`,
    `- [Reconstitution dose calculator](${BASE_URL}/calculator): Interactive BAC water / concentration calculator`,
    `- [Peptide guide](${BASE_URL}/guide): Reconstitution, storage and handling`,
    `- [Certificates of Analysis](${BASE_URL}/coa): Third-party testing methodology and how to request a batch COA`,
    `- [FAQ](${BASE_URL}/faq): Purity, COA, shipping, ordering and payment questions`,
    `- [Shipping policy](${BASE_URL}/shipping): Delivery times and coverage across Peninsular Malaysia`,
    `- [About Ascend MY](${BASE_URL}/about): Who we are`,
    `- [Terms & Conditions](${BASE_URL}/terms): Ordering, payment, and returns terms`,
    `- [Disclaimer](${BASE_URL}/disclaimer): Research-use-only compliance statement`,
    `- [Privacy Policy](${BASE_URL}/privacy): Data handling and privacy practices`,
    '',
    '## Products',
    ...productLines,
    ...(insightLines.length > 0 ? ['', '## Insights', ...insightLines] : []),
    '',
    '## Key facts',
    marketFactLine,
    shippingFactLine,
    '- Quality: 99%+ purity, third-party tested, Certificate of Analysis on request.',
    '- Contact: WhatsApp +60 11-6109 2723.',
    '- Disclaimer: all products are for research and laboratory use only.',
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
