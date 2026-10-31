import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthScreen } from '@/components/account/AuthScreen';
import { pickAuthBatch } from '@/components/account/auth-batch';
import { GROUP_BUY_ENABLED } from '@/lib/features';

export const metadata: Metadata = {
  title: 'Sign in',
  description: GROUP_BUY_ENABLED
    ? 'Sign in to your Ascend MY account to follow your orders and Group Buy batches.'
    : 'Sign in to your Ascend MY account.',
  robots: { index: false, follow: true },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const batch = await pickAuthBatch((await searchParams).next);
  return (
    <Suspense>
      <AuthScreen mode="signin" where="store" batch={batch} />
    </Suspense>
  );
}
