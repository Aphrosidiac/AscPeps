import type { Metadata } from 'next';
import { BreadcrumbJsonLd } from '@/components/JsonLd';

const BASE_URL = 'https://ascendpeptides.my';

export const metadata: Metadata = {
  title: 'Buy Research Peptides Online in Malaysia',
  description: 'Browse ASCEND\'s full range of premium research peptides. Retatrutide, GHK-Cu, BPC-157, Tesamorelin, AOD9604, MOTS-c and more. Best prices in Malaysia with fast shipping.',
  keywords: ['buy peptides malaysia', 'peptides online malaysia', 'retatrutide buy malaysia', 'GHK-Cu malaysia', 'peptide shop malaysia'],
  alternates: { canonical: 'https://ascendpeptides.my/products' },
  openGraph: {
    title: 'Buy Research Peptides Online in Malaysia | ASCEND',
    description: 'Browse premium research peptides. Retatrutide, GHK-Cu, BPC-157 and more. Best prices in Malaysia.',
    url: 'https://ascendpeptides.my/products',
    images: [{ url: `${BASE_URL}/images/hero-vials.webp`, alt: 'ASCEND peptide vials' }],
  },
  twitter: {
    card: 'summary',
    title: 'Buy Research Peptides Online in Malaysia | ASCEND',
    description: 'Browse premium research peptides. Retatrutide, GHK-Cu, BPC-157 and more. Best prices in Malaysia.',
    images: [`${BASE_URL}/images/hero-vials.webp`],
  },
};

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: BASE_URL },
          { name: 'Products', url: `${BASE_URL}/products` },
        ]}
      />
      {children}
    </>
  );
}
