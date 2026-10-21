'use client';

import { Wallet } from 'lucide-react';
import { PageHeader } from '@/components/admin/ui';
import { SectionTabs } from '../money-ui';

/**
 * Ascend Money: the bank, sharing profit out, partners and spending, as one
 * place with a tab per job. Replaced Finance when Ascend got its own bank
 * account (2026-10-21) — docs/ascend-bank-plan.md.
 */
export default function MoneyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader
        icon={Wallet}
        title="Ascend Money"
        subtitle="Ascend’s bank, the profit split, and what everyone is owed"
        className="mb-4"
      />
      <SectionTabs />
      {children}
    </div>
  );
}
