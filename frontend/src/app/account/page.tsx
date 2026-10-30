import type { Metadata } from 'next';
import { AccountSettings } from '@/components/account/AccountSettings';

export const metadata: Metadata = {
  title: 'Your account | Ascend MY',
  robots: { index: false, follow: true },
};

export default function AccountPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
      <div className="mb-8 border-b border-[#0A0A0A]/10 pb-6">
        <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#0A0A0A]">Your account</h1>
        <p className="mt-2 text-[15px] text-[#0A0A0A]/60">Your name, email and password. The same account works in Group Buy.</p>
      </div>
      <AccountSettings where="store" />
    </div>
  );
}
