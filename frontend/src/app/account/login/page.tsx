import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginClient } from './LoginClient';

export const metadata: Metadata = {
  title: 'Sign in | Ascend MY',
  description: 'Sign in to your Ascend MY account to comment on Insights articles.',
  // Account screens carry no content worth indexing and would only dilute the
  // catalog's crawl budget.
  robots: { index: false, follow: true },
};

export default function AccountLoginPage() {
  // useSearchParams() (for ?next=) opts a client component out of static
  // prerendering unless it sits behind a Suspense boundary.
  return (
    <Suspense>
      <LoginClient />
    </Suspense>
  );
}
