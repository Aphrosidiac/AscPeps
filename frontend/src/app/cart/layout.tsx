import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Your Cart',
  robots: { index: false },
};

export default function CartLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
