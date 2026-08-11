import type { Metadata } from 'next';
import { AccountClient } from './AccountClient';

export const metadata: Metadata = {
  title: 'Your account | Ascend MY',
  robots: { index: false, follow: true },
};

export default function AccountPage() {
  return <AccountClient />;
}
