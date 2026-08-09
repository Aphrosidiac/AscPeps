import type { Metadata } from 'next';
import { Suspense } from 'react';
import { UnsubscribeClient } from './UnsubscribeClient';

export const metadata: Metadata = {
  title: 'Unsubscribe',
  description: 'Manage your ASCEND email preferences.',
  // A page reached only from an email footer, whose URL carries a token. It
  // has nothing to rank for and the token should never end up in an index.
  robots: { index: false, follow: false },
};

export default function UnsubscribePage() {
  return (
    <div className="max-w-lg mx-auto px-4 py-20 sm:py-28">
      <Suspense fallback={null}>
        <UnsubscribeClient />
      </Suspense>
    </div>
  );
}
