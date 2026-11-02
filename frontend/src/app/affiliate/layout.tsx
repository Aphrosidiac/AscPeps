import type { Metadata } from 'next';
import './affiliate.css';
import { AffShell } from './AffShell';

export const metadata: Metadata = {
  title: { default: 'Ascend Affiliate', template: '%s · Ascend Affiliate' },
  description: 'Share Ascend MY with your own code: your people get a discount, you earn on every paid order.',
  robots: { index: false, follow: false },
};

// The store's header, footer and popups are dropped in the browser on
// affiliate.ascendpeptides.my (components/layout/SiteChrome.tsx); this hides
// them from the very first paint so they never flash. The theme is set before
// paint too, from the switch's saved choice.
const BOOT = `body:has(> main [data-affiliate-root]) > :not(main) { display: none !important; }`;
const THEME = `(function(){try{var t=localStorage.getItem('ascend-aff-theme');if(t==='dark')document.currentScript.parentElement.setAttribute('data-theme','dark')}catch(e){}})()`;

export default function AffiliateLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="aff" data-affiliate-root suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: THEME }} />
      <style dangerouslySetInnerHTML={{ __html: BOOT }} />
      <AffShell>{children}</AffShell>
    </div>
  );
}
