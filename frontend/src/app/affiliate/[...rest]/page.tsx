'use client';

import { usePortalPath, useStoreOrigin } from '../aff-ui';

/**
 * Any other path on affiliate.ascendpeptides.my: most are the store's
 * (/checkout, /products/…), so offer it there rather than a bare 404. It may
 * just be a wrong address, so it doesn't promise the page exists.
 */
export default function ElsewherePage() {
  const store = useStoreOrigin();
  const path = usePortalPath();
  return (
    <div className="panel mx-auto max-w-[520px] p-8">
      <h1 className="st-h fg">That page isn&apos;t on the affiliate site</h1>
      <p className="mt-2 text-[14px] leading-[21px] fg-2">If it&apos;s a store page, you&apos;ll find it at ascendpeptides.my.</p>
      <a href={`${store}${path}`} className="btn btn-ink btn-sm mt-5 inline-flex">
        Try it on the store
      </a>
    </div>
  );
}
