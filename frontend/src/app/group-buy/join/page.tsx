import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthScreen } from '@/components/account/AuthScreen';
import { pickAuthBatch } from '@/components/account/auth-batch';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Create a free account to follow your Group Buy orders, batch timelines and rewards.',
  robots: { index: false, follow: true },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const batch = await pickAuthBatch((await searchParams).next);
  return (
    <Suspense>
      <AuthScreen mode="signup" where="group-buy" batch={batch} />
    </Suspense>
  );
}
