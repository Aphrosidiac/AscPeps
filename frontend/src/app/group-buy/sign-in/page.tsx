import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthScreen } from '@/components/account/AuthScreen';
import { pickAuthBatch } from '@/components/account/auth-batch';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to follow your Group Buy orders and batch timelines.',
  robots: { index: false, follow: true },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const batch = await pickAuthBatch((await searchParams).next);
  return (
    <Suspense>
      <AuthScreen mode="signin" where="group-buy" batch={batch} />
    </Suspense>
  );
}
