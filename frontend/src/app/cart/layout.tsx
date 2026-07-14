import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Your Cart',
  robots: { index: false },
  alternates: { canonical: 'https://ascendpeptides.my/cart' },
};

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
