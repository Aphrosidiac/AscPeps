import type { Metadata } from 'next';

const BASE_URL = 'https://ascendpeptides.my';

export const metadata: Metadata = {
  title: 'Buy Research Peptides Online in Malaysia',
  description: 'Browse Ascend MY\'s full range of premium research peptides. Retatrutide, GHK-Cu, BPC-157, Tesamorelin, AOD9604, MOTS-c and more. Best prices in Malaysia with fast shipping.',
  keywords: ['buy peptides malaysia', 'peptides online malaysia', 'retatrutide buy malaysia', 'GHK-Cu malaysia', 'peptide shop malaysia'],
  alternates: { canonical: 'https://ascendpeptides.my/products' },
  openGraph: {
    title: 'Buy Research Peptides Online in Malaysia | Ascend MY',
    description: 'Browse premium research peptides. Retatrutide, GHK-Cu, BPC-157 and more. Best prices in Malaysia.',
    url: 'https://ascendpeptides.my/products',
    images: [{ url: `${BASE_URL}/images/hero-vials.webp`, alt: 'Ascend MY peptide vials' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Buy Research Peptides Online in Malaysia | Ascend MY',
    description: 'Browse premium research peptides. Retatrutide, GHK-Cu, BPC-157 and more. Best prices in Malaysia.',
    images: [`${BASE_URL}/images/hero-vials.webp`],
  },
};

// No BreadcrumbList here: a layout crumb also renders under /products/[slug],
// which already emits its own three-level trail, so every product page carried
// two competing BreadcrumbLists. The catalog's crumb lives in page.tsx.
export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
