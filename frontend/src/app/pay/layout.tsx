import type { ReactNode } from 'react';
import 'manualpaygate/styles.css';

/**
 * The hosted payment page. SiteChrome already strips the storefront header
 * and footer for /pay/*; this layout only brings in the page's own stylesheet
 * (scoped under `.mpg`, so it cannot leak into the rest of the site).
 */
export default function PayLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
