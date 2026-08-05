import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegisterClient } from './RegisterClient';

export const metadata: Metadata = {
  title: 'Create an account | ASCEND',
  description: 'Create an ASCEND account to comment on Insights articles.',
  robots: { index: false, follow: true },
};

export default function AccountRegisterPage() {
  return (
    <Suspense>
      <RegisterClient />
    </Suspense>
  );
}
