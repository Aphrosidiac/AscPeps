import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Buy Research Peptides Online in Malaysia',
  description: 'Browse ASCEND\'s full range of premium research peptides. Retatrutide, GHK-Cu, BPC-157, Tesamorelin, AOD9604, MOTS-c and more. Best prices in Malaysia with fast shipping.',
  keywords: ['buy peptides malaysia', 'peptides online malaysia', 'retatrutide buy malaysia', 'GHK-Cu malaysia', 'peptide shop malaysia'],
  alternates: { canonical: 'https://ascend.apdevotion.my/products' },
  openGraph: {
    title: 'Buy Research Peptides Online in Malaysia | ASCEND',
    description: 'Browse premium research peptides. Retatrutide, GHK-Cu, BPC-157 and more. Best prices in Malaysia.',
    url: 'https://ascend.apdevotion.my/products',
  },
};

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
