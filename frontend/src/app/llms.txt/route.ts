import type { Product } from '@/types';
import { getFullProductName } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3105';
const BASE_URL = 'https://ascendpeptides.my';

export const revalidate = 3600;

export async function GET() {
  let products: Product[] = [];
  let settings: Record<string, string> = {};
  try {
    const [productsRes, settingsRes] = await Promise.all([
      fetch(`${API_URL}/api/v1/products?limit=100`, { next: { revalidate: 3600 } }),
      fetch(`${API_URL}/api/v1/settings`, { next: { revalidate: 3600 } }),
    ]);
    if (productsRes.ok) products = (await productsRes.json()).data || [];
    if (settingsRes.ok) settings = await settingsRes.json();
  } catch {}

  const shippingFee = settings.shipping_fee || '';
  const freeShipping = !shippingFee || shippingFee === '0';
  const shippingSummaryClause = freeShipping ? 'free, fast nationwide shipping' : 'fast nationwide shipping';
  const shippingFactLine = freeShipping
    ? '- Currency: MYR. Shipping: free on all orders. Payment: bank transfer, FPX, credit/debit card.'
    : `- Currency: MYR. Shipping: flat RM${shippingFee} on all orders. Payment: bank transfer, FPX, credit/debit card.`;

  const productLines = products.map((p) => {
    const price = `RM${(p.price / 100).toFixed(2)}`;
    const cat = p.category?.name ? ` — ${p.category.name}` : '';
    return `- [${getFullProductName(p)}](${BASE_URL}/products/${p.slug}): ${price}${cat}`;
  });

  const body = [
    '# ASCEND — Research Peptides Malaysia',
    '',
    `> ASCEND is Malaysia's premium research-peptide supplier. All compounds are lab-grade, manufactured to 99%+ purity and independently third-party tested (Certificate of Analysis available). Prices are in Malaysian Ringgit (MYR) with ${shippingSummaryClause}. No account required. All products are sold strictly for laboratory and research purposes only.`,
    '',
    '## Key pages',
    `- [Shop all peptides](${BASE_URL}/products): Full catalog with live MYR pricing and stock`,
    `- [Reconstitution dose calculator](${BASE_URL}/calculator): Interactive BAC water / concentration calculator`,
    `- [Peptide guide](${BASE_URL}/guide): Reconstitution, storage and handling`,
    `- [Certificates of Analysis](${BASE_URL}/coa): Third-party testing methodology and how to request a batch COA`,
    `- [FAQ](${BASE_URL}/faq): Purity, COA, shipping, ordering and payment questions`,
    `- [Shipping policy](${BASE_URL}/shipping): Nationwide delivery times and coverage`,
    `- [About ASCEND](${BASE_URL}/about): Who we are`,
    `- [Terms & Conditions](${BASE_URL}/terms): Ordering, payment, and returns terms`,
    `- [Disclaimer](${BASE_URL}/disclaimer): Research-use-only compliance statement`,
    `- [Privacy Policy](${BASE_URL}/privacy): Data handling and privacy practices`,
    '',
    '## Products',
    ...productLines,
    '',
    '## Key facts',
    '- Market served: Malaysia (nationwide shipping, including Sabah & Sarawak).',
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
