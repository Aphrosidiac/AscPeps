import type { Metadata } from 'next';
import { DM_Mono } from 'next/font/google';
import { notFound } from 'next/navigation';
import { GROUP_BUY_ENABLED } from '@/lib/features';
import { PortalShell } from './PortalShell';
import './portal.css';

const mono = DM_Mono({ variable: '--font-dm-mono', subsets: ['latin'], weight: ['400', '500'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Group Buy', template: '%s | Group Buy | Ascend MY' },
  description: 'Time-limited Group Buy batches from Ascend MY: wholesale tier pricing on research peptides, shipped together when the batch arrives.',
};

// The Group Buy portal has its own chrome (SiteChrome leaves /group-buy alone),
// built on FF Ops' client-portal structure in the Ascend palette — portal.css.
export default function GroupBuyLayout({ children }: { children: React.ReactNode }) {
  if (!GROUP_BUY_ENABLED) notFound();
  return <PortalShell className={mono.variable}>{children}</PortalShell>;
}
