import type { Metadata } from 'next';
import { PageHead } from '@/components/group-buy/portal-ui';
import { AccountSettings } from '@/components/account/AccountSettings';

export const metadata: Metadata = {
  title: 'Account',
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <div>
      <PageHead eyebrow="Group Buy" title="Account">Your name, email and password. The same account works in the store.</PageHead>
      <AccountSettings where="group-buy" />
    </div>
  );
}
