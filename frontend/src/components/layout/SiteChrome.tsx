'use client';

import { usePathname } from 'next/navigation';
import { AnnouncementBar } from './AnnouncementBar';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { WhatsAppButton } from './WhatsAppButton';

interface SiteChromeProps {
  announcementEnabled: boolean;
  announcementText: string;
  children: React.ReactNode;
}

// The admin panel (/admin/*) has its own sidebar/nav chrome and isn't part
// of the customer-facing storefront — it must never be wrapped in the
// public announcement bar, navbar, footer, or WhatsApp button. Gated here
// (rather than per-admin-page) so no future storefront page can forget it.
export function SiteChrome({ announcementEnabled, announcementText, children }: SiteChromeProps) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin');

  if (isAdmin) {
    return <>{children}</>;
  }

  return (
    <>
      <AnnouncementBar enabled={announcementEnabled} text={announcementText} />
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
      <WhatsAppButton />
    </>
  );
}
