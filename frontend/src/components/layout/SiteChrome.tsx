'use client';

import { usePathname } from 'next/navigation';
import { AnnouncementBar } from './AnnouncementBar';
import { PendingPaymentBar } from './PendingPaymentBar';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { WhatsAppButton } from './WhatsAppButton';
import { NewsletterPopup } from '@/components/newsletter/NewsletterPopup';
import { GroupBuyBanner } from '@/components/group-buy/GroupBuyBanner';
import { GroupBuyPopup } from '@/components/group-buy/GroupBuyPopup';
import type { GroupBuyPromo } from '@/types';

interface SiteChromeProps {
  announcementEnabled: boolean;
  announcementText: string;
  newsletterPopupEnabled: boolean;
  newsletterPopupHeading: string;
  newsletterPopupBody: string;
  /** What Group Buy shows on the store right now (Admin → Group Buys → Promotion). */
  groupBuyPromo?: GroupBuyPromo;
  children: React.ReactNode;
}

// The admin panel (/admin/*) has its own sidebar/nav chrome and isn't part
// of the customer-facing storefront — it must never be wrapped in the
// public announcement bar, navbar, footer, or WhatsApp button. Gated here
// (rather than per-admin-page) so no future storefront page can forget it.
export function SiteChrome({
  announcementEnabled,
  announcementText,
  newsletterPopupEnabled,
  newsletterPopupHeading,
  newsletterPopupBody,
  groupBuyPromo,
  children,
}: SiteChromeProps) {
  const pathname = usePathname();
  const isAdmin = pathname?.startsWith('/admin');
  // The hosted payment page (/pay/cs_…) is a Stripe-style standalone page:
  // no header, footer, announcement bar or newsletter popup between the
  // customer and the bank details.
  const isPayPage = pathname?.startsWith('/pay/');
  // The Group Buy portal brings its own shell (app/group-buy/PortalShell.tsx).
  const isGroupBuy = pathname === '/group-buy' || pathname?.startsWith('/group-buy/');
  // Only the product detail page has the mobile sticky Add to Cart bar the
  // WhatsApp button needs to clear — see WhatsAppButton's `raised` prop.
  const isProductDetail = pathname ? /^\/products\/[^/]+$/.test(pathname) : false;

  if (isAdmin || isPayPage) {
    return <>{children}</>;
  }

  // The portal brings its own chrome, but the batch banner stays on top so
  // switching between the store and Group Buy doesn't make the bar jump.
  if (isGroupBuy) {
    return (
      <>
        {groupBuyPromo?.banner && <GroupBuyBanner banner={groupBuyPromo.banner} />}
        {children}
      </>
    );
  }

  return (
    <>
      {/* A live Group Buy banner takes the announcement bar's place: two
          strips above the logo would push the store below the fold. */}
      {groupBuyPromo?.banner
        ? <GroupBuyBanner banner={groupBuyPromo.banner} />
        : <AnnouncementBar enabled={announcementEnabled} text={announcementText} />}
      <PendingPaymentBar />
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
      <WhatsAppButton raised={isProductDetail} />
      {/* Mounted at the chrome level so the popup's own path exclusions are
          the single place that decides where it may appear — a per-page mount
          would mean every new storefront page has to remember to opt out. */}
      {groupBuyPromo?.popup && <GroupBuyPopup popup={groupBuyPromo.popup} />}
      {/* One popup per shopper: the newsletter waits while a batch has its own. */}
      <NewsletterPopup
        enabled={newsletterPopupEnabled && !groupBuyPromo?.popup}
        heading={newsletterPopupHeading}
        body={newsletterPopupBody}
      />
    </>
  );
}
