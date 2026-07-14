import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Track Your Order',
  description: 'Track your ASCEND peptide order status using your phone number. Real-time order tracking for all Malaysian deliveries.',
  robots: { index: false },
  alternates: { canonical: 'https://ascendpeptides.my/track' },
};

export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
