'use client';

import { useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { AnnouncementBar } from './AnnouncementBar';
import { PendingPaymentBar } from './PendingPaymentBar';
import { Navbar } from './Navbar';
import { Footer } from './Footer';
import { WhatsAppButton } from './WhatsAppButton';
import { NewsletterPopup } from '@/components/newsletter/NewsletterPopup';
import { GroupBuyBanner } from '@/components/group-buy/GroupBuyBanner';
import { GroupBuyPopup } from '@/components/group-buy/GroupBuyPopup';
import { PromoPopup } from '@/components/popups/PromoPopup';
import { usePopupTurn, type PopupKind } from '@/components/popups/popup-turn';
import { getMemberToken } from '@/lib/member-session';
import { AFFILIATE_URL } from '@/lib/affiliate-url';
import { RefCapture } from '@/lib/ref-code';
import type { GroupBuyPromo } from '@/types';

interface SiteChromeProps {
  announcementEnabled: boolean;
  announcementText: string;
  newsletterPopupEnabled: boolean;
  newsletterPopupHeading: string;
  newsletterPopupBody: string;
  /** What Group Buy shows on the store right now (Admin → Group Buys → Promotion). */
  groupBuyPromo?: GroupBuyPromo;
  /** At least one research article is live: the header links to /research. */
  researchLive?: boolean;
  /** Ascend Affiliate is open: the "become an affiliate" popup may show. */
  affiliate?: { discountPct: number; commission: string } | null;
  /** The one-time sign-up bonus is on: the "create an account" popup may show. */
  signupBonusPct?: number | null;
  children: React.ReactNode;
}

const noop = () => () => {};
const onAffiliateHost = () => window.location.hostname.startsWith('affiliate.');
const signedIn = () => !!getMemberToken();

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
  researchLive,
  affiliate,
  signupBonusPct,
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
  // Ascend Affiliate (app/affiliate, served at affiliate.ascendpeptides.my)
  // is its own site with its own shell — nothing of the store's around it.
  const isAffiliate = pathname === '/affiliate' || pathname?.startsWith('/affiliate/');
  // On affiliate.ascendpeptides.my the proxy serves app/affiliate under the
  // short paths, so the pathname above reads "/" there. The host is only
  // known in the browser: the first paint keeps the store's markup (hidden by
  // the portal's own style, app/affiliate/layout.tsx) and it is dropped right
  // after hydration — <main> stays in place so the portal is not remounted.
  const bare = useSyncExternalStore(noop, onAffiliateHost, () => false);

  // One store popup per visit, taking turns (components/popups/popup-turn.ts).
  const kinds: PopupKind[] = [];
  if (newsletterPopupEnabled) kinds.push('newsletter');
  if (signupBonusPct) kinds.push('signup');
  if (affiliate) kinds.push('affiliate');
  const turn = usePopupTurn(groupBuyPromo?.popup || bare ? [] : kinds);
  // Only the product detail page has the mobile sticky Add to Cart bar the
  // WhatsApp button needs to clear — see WhatsAppButton's `raised` prop.
  const isProductDetail = pathname ? /^\/products\/[^/]+$/.test(pathname) : false;

  if (isAdmin || isPayPage || isAffiliate) {
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
      {!bare && (groupBuyPromo?.banner
        ? <GroupBuyBanner banner={groupBuyPromo.banner} />
        : <AnnouncementBar enabled={announcementEnabled} text={announcementText} />)}
      {!bare && <PendingPaymentBar />}
      {!bare && <Navbar researchLive={researchLive} />}
      <main className="flex-1">{children}</main>
      {!bare && <Footer />}
      {!bare && <WhatsAppButton raised={isProductDetail} />}
      {!bare && <RefCapture />}
      {/* Mounted at the chrome level so the popup's own path exclusions are
          the single place that decides where it may appear — a per-page mount
          would mean every new storefront page has to remember to opt out. */}
      {!bare && groupBuyPromo?.popup && <GroupBuyPopup popup={groupBuyPromo.popup} />}
      {/* One popup per shopper: the others wait while a batch has its own,
          and take turns visit by visit otherwise. */}
      <NewsletterPopup
        enabled={newsletterPopupEnabled && !groupBuyPromo?.popup && turn === 'newsletter'}
        heading={newsletterPopupHeading}
        body={newsletterPopupBody}
      />
      {signupBonusPct ? (
        <PromoPopup
          id="signup"
          enabled={turn === 'signup'}
          heading={`${signupBonusPct}% off your first order`}
          body="Create a free Ascend MY account and we'll give you a one-time code for your first order. Track your orders and check out faster too."
          ctaLabel="Create my account"
          href="/account/register"
          note="Your code appears once you confirm your email."
          skip={signedIn}
        />
      ) : null}
      {affiliate ? (
        <PromoPopup
          id="affiliate"
          enabled={turn === 'affiliate'}
          heading="Share Ascend, earn on every order"
          body={`Become an Ascend affiliate: your own code gives your people ${affiliate.discountPct}% off, and you earn ${affiliate.commission} of every paid order made with it.`}
          ctaLabel="Become an affiliate"
          href={AFFILIATE_URL}
          note="Free to join. Paid to your bank account."
        />
      ) : null}
    </>
  );
}
