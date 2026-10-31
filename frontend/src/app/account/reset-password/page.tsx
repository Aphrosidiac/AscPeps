import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthScreen } from '@/components/account/AuthScreen';

export const metadata: Metadata = {
  title: 'Choose a new password',
  description: 'Choose a new password for your account.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense>
      <AuthScreen mode="reset" where="store" batch={null} />
    </Suspense>
  );
}
