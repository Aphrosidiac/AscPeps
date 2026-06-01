import type { Product } from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3105';
const BASE_URL = 'https://ascendpeptides.my';

export const revalidate = 3600;

export async function GET() {
  let products: Product[] = [];
  try {
    const res = await fetch(`${API_URL}/api/v1/products?limit=100`, { next: { revalidate: 3600 } });
    if (res.ok) {
      const json = await res.json();
      products = json.data || [];
    }
  } catch {}

  const productLines = products.map((p) => {
    const size = p.size ? ` ${p.size}` : '';
    const price = `RM${(p.price / 100).toFixed(2)}`;
    const cat = p.category?.name ? ` — ${p.category.name}` : '';
    return `- [${p.name}${size}](${BASE_URL}/products/${p.slug}): ${price}${cat}`;
  });

  const body = [
    '# ASCEND — Research Peptides Malaysia',
    '',
    "> ASCEND is Malaysia's premium research-peptide supplier. All compounds are lab-grade, manufactured to 99%+ purity and independently third-party tested (Certificate of Analysis available). Prices are in Malaysian Ringgit (MYR) with free, fast nationwide shipping. No account required. All products are sold strictly for laboratory and research purposes only — not for human consumption.",
    '',
    '## Key pages',
    `- [Shop all peptides](${BASE_URL}/products): Full catalog with live MYR pricing and stock`,
    `- [Peptide guide](${BASE_URL}/guide): Reconstitution, storage and handling`,
    `- [FAQ](${BASE_URL}/faq): Purity, COA, shipping, ordering and payment questions`,
    `- [Shipping policy](${BASE_URL}/shipping): Nationwide delivery times and coverage`,
    `- [About ASCEND](${BASE_URL}/about): Who we are`,
    '',
    '## Products',
    ...productLines,
    '',
    '## Key facts',
    '- Market served: Malaysia (nationwide shipping, including Sabah & Sarawak).',
    '- Currency: MYR. Shipping: free on all orders. Payment: bank transfer, FPX, credit/debit card.',
    '- Quality: 99%+ purity, third-party tested, Certificate of Analysis on request.',
    '- Contact: WhatsApp +60 11-6109 2723.',
    '- Disclaimer: research use only; not for human consumption.',
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
