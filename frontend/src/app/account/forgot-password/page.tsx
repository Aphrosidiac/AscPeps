import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthScreen } from '@/components/account/AuthScreen';

export const metadata: Metadata = {
  title: 'Forgot password',
  description: 'Get a link to choose a new password.',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense>
      <AuthScreen mode="forgot" where="store" batch={null} />
    </Suspense>
  );
}
