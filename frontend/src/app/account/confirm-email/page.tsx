import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ConfirmEmail } from '@/components/account/ConfirmEmail';

export const metadata: Metadata = {
  title: 'Confirm your new email',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <Suspense>
      <ConfirmEmail where="store" />
    </Suspense>
  );
}
