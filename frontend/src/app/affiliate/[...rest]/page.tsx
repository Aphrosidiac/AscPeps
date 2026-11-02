'use client';

import { usePortalPath, useStoreOrigin } from '../aff-ui';

/**
 * Any other path on affiliate.ascendpeptides.my (/checkout, /products/…) is
 * the store's: say so and link to it there, rather than a bare 404.
 */
export default function ElsewherePage() {
  const store = useStoreOrigin();
  const path = usePortalPath();
  return (
    <div className="panel mx-auto max-w-[520px] p-8">
      <h1 className="st-h fg">That page is on the store</h1>
      <p className="mt-2 text-[14px] leading-[21px] fg-2">This is the affiliate site. The page you opened lives at ascendpeptides.my.</p>
      <a href={`${store}${path}`} className="btn btn-ink btn-sm mt-5 inline-flex">
        Open it on the store
      </a>
    </div>
  );
}
