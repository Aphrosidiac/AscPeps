'use client';

import { useEffect, useState } from 'react';
import { getMyAffiliateOrders, STATE_LABEL, type AffiliateOrder } from '@/lib/affiliate-api';
import { GuideLink, PageHead, STATE_TONE, rm, when } from '../aff-ui';

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
      <PageHead
        title="Orders"
        sub={res ? `${res.total} ${res.total === 1 ? 'order' : 'orders'} with your code` : 'Orders made with your code'}
        actions={<GuideLink section="earning">How earning works</GuideLink>}
      />
      <section className="panel p-4 sm:p-6">
        {failed ? (
          <p className="p-2 text-[14px] fg-2">Couldn&apos;t load your orders. Refresh to try again.</p>
        ) : !shown ? (
          <div className="h-40 rounded-[18px]" style={{ background: 'var(--st-field)', opacity: 0.6 }} />
        ) : shown.rows.length === 0 ? (
          <p className="p-2 text-[14px] fg-2">No orders yet. Share your code and they&apos;ll show up here.</p>
        ) : (
          <>
          {/* A phone: one card an order, everything the table shows. */}
          <ul className="sm:hidden">
            {shown.rows.map((o) => (
              <li key={o.id} className="border-t px-2 py-3.5 first:border-t-0" style={{ borderColor: 'var(--st-hair)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium fg tnum">{o.orderNumber}</p>
                    <p className="text-[12px] fg-3">{when(o.placedAt)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="whitespace-nowrap text-[15px] font-semibold fg tnum" style={o.state === 'AWAITING_PAYMENT' ? { color: 'var(--st-fg-3)' } : undefined}>
                      {rm(o.commission)}
                    </p>
                    <p className="text-[12px] fg-3">{o.rate}</p>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className={`pill ${STATE_TONE[o.state]}`}>{STATE_LABEL[o.state]}</span>
                  <span className="whitespace-nowrap text-[12px] fg-3 tnum">on {rm(o.goods)} goods</span>
                </div>
                {o.readyAt ? <p className="mt-1.5 text-[12px] fg-2">Available {when(o.readyAt, true)}</p> : null}
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
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
                      {o.readyAt ? <span className="mt-1 block text-[12px] fg-2">Available {when(o.readyAt, true)}</span> : null}
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
          </>
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
        Commission is counted once an order is paid. &quot;Awaiting payment&quot; shows what it will earn. &quot;In hold&quot; means it is earned and waiting: you can ask for it from the date shown. A refund takes back the same share of the commission.
      </p>
    </>
  );
}
