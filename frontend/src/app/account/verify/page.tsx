import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyClient } from './VerifyClient';

export const metadata: Metadata = {
  title: 'Confirm your email | ASCEND',
  robots: { index: false, follow: false },
};

export default function AccountVerifyPage() {
  return (
    <Suspense>
      <VerifyClient />
    </Suspense>
  );
}
