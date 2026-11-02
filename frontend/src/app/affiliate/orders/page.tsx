'use client';

import { useEffect, useState } from 'react';
import { getMyAffiliateOrders, STATE_LABEL, type AffiliateOrder } from '@/lib/affiliate-api';
import { PageHead, STATE_TONE, rm, when } from '../aff-ui';

export default function AffiliateOrders() {
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<{ page: number; rows: AffiliateOrder[]; pages: number; total: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getMyAffiliateOrders(page).then(
      (r) => live && setRes({ page, rows: r.data, pages: r.pagination.totalPages, total: r.pagination.total }),
      () => live && setFailed(true)
    );
    return () => {
      live = false;
    };
  }, [page]);

  const shown = res?.page === page ? res : null;

  return (
    <>
      <PageHead title="Orders" sub={res ? `${res.total} ${res.total === 1 ? 'order' : 'orders'} with your code` : 'Orders made with your code'} />
      <section className="panel p-4 sm:p-6">
        {failed ? (
          <p className="p-2 text-[14px] fg-2">Couldn&apos;t load your orders. Refresh to try again.</p>
        ) : !shown ? (
          <div className="h-40 rounded-[18px]" style={{ background: 'var(--st-field)', opacity: 0.6 }} />
        ) : shown.rows.length === 0 ? (
          <p className="p-2 text-[14px] fg-2">No orders yet. Share your code and they&apos;ll show up here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Order</th>
                  <th className="hidden sm:table-cell">Placed</th>
                  <th>Status</th>
                  <th className="num hidden md:table-cell">Goods</th>
                  <th className="num">Commission</th>
                </tr>
              </thead>
              <tbody>
                {shown.rows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <p className="font-medium fg tnum">{o.orderNumber}</p>
                      <p className="text-[12px] fg-3 sm:hidden">{when(o.placedAt)}</p>
                    </td>
                    <td className="hidden fg-2 sm:table-cell">{when(o.placedAt)}</td>
                    <td>
                      <span className={`pill ${STATE_TONE[o.state]}`}>{STATE_LABEL[o.state]}</span>
                    </td>
                    <td className="num hidden fg-2 md:table-cell">{rm(o.goods)}</td>
                    <td className="num">
                      <span className="font-medium fg" style={o.state === 'AWAITING_PAYMENT' ? { color: 'var(--st-fg-3)' } : undefined}>
                        {rm(o.commission)}
                      </span>
                      <span className="block text-[12px] fg-3">{o.rate}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {shown && shown.pages > 1 ? (
          <div className="mt-4 flex items-center justify-between gap-2">
            <button type="button" className="btn btn-soft btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button>
            <span className="text-[13px] fg-3 tnum">Page {page} of {shown.pages}</span>
            <button type="button" className="btn btn-soft btn-sm" disabled={page >= shown.pages} onClick={() => setPage(page + 1)}>Older</button>
          </div>
        ) : null}
      </section>
      <p className="mt-4 px-2 text-[12px] leading-[17px] fg-3">
        Commission is counted once an order is paid. &quot;Waiting for payment&quot; shows what it will earn. A refund takes back the same share of the commission.
      </p>
    </>
  );
}
