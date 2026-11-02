'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { Search } from 'lucide-react';
import { getProducts } from '@/lib/api';
import { getBestSellerOrder } from '@/lib/affiliate-api';
import { canPreorder, usePreorder } from '@/lib/preorder';
import { getEffectivePrice, isSaleActive } from '@/lib/utils';
import type { Product } from '@/types';
import { CopyButton, PageHead, rm, useAff, useStoreOrigin } from '../aff-ui';

/**
 * Everything the code works on, and what it earns: the store's own list and
 * prices (sale prices included, the same rule checkout uses), less the
 * customer's discount, times the affiliate's rate. Best sellers first (units
 * on paid orders, from the API — the order only, never the counts); sizes that
 * haven't sold keep the store's own order after them. The quantity is a
 * "what if" the affiliate picks; nothing here is stored.
 *
 * Earned = price × (1 − discount) × rate — the order's goods after the code,
 * shipping left out (utils/affiliate.ts on the API).
 */

const QUICK = [1, 5, 10, 25, 50];

interface Row {
  key: string;
  name: string;
  size: string | null;
  code: string;
  slug: string;
  image: string | null;
  price: number;
  was: number | null;
  stock: 'in' | 'preorder' | 'out';
}

/** The product's photo, or a plain tile when there is none (or it fails to load). */
function Thumb({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[12px]" style={{ background: 'var(--st-field)' }}>
      {src && !broken ? <Image src={src} alt="" fill sizes="44px" className="object-cover" onError={() => setBroken(true)} /> : null}
    </span>
  );
}

async function loadAll(): Promise<Product[]> {
  const first = await getProducts({ limit: 100, page: 1 });
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, first.pagination.totalPages - 1) }, (_, i) => getProducts({ limit: 100, page: i + 2 }))
  );
  return [first, ...rest].flatMap((r) => r.data);
}

export default function AffiliateProducts() {
  const { data } = useAff();
  const a = data.affiliate!;
  const store = useStoreOrigin();
  const preorder = usePreorder();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [ranking, setRanking] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [qty, setQty] = useState(10);
  const [custom, setCustom] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    // The ranking only reorders: without it the list still shows, in the store's order.
    Promise.all([loadAll(), getBestSellerOrder().catch(() => [] as string[])]).then(
      ([p, r]) => {
        if (!live) return;
        setRanking(r);
        setProducts(p);
      },
      () => live && setFailed(true)
    );
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo<Row[]>(() => {
    if (!products) return [];
    const q = query.trim().toLowerCase();
    const rank = new Map(ranking.map((id, i) => [id, i]));
    const at = (id: string) => rank.get(id) ?? ranking.length;
    const all = products.flatMap((p) =>
      p.variants
        .filter((v) => v.active)
        .map((v) => ({
          key: v.id,
          name: p.name,
          size: v.size,
          code: v.code,
          slug: p.slug,
          image: v.imageUrl,
          price: getEffectivePrice(v),
          was: isSaleActive(v) ? v.price : null,
          stock: (v.stock > 0 ? 'in' : canPreorder(preorder, v) ? 'preorder' : 'out') as Row['stock'],
        }))
        .filter((r) => !q || `${r.name} ${r.size ?? ''} ${r.code}`.toLowerCase().includes(q))
    );
    // A stable sort, so unsold sizes stay in the store's order.
    return all.sort((x, y) => at(x.key) - at(y.key));
  }, [products, query, preorder, ranking]);

  // The product's own page with the code, picked up by the store's RefCapture.
  const link = (slug: string) => `${store}/products/${slug}?ref=${a.code}`;
  const pays = (price: number) => Math.round((price * (100 - a.customerDiscountPct)) / 100);
  const earns = (price: number, n: number) => Math.round((price * n * (100 - a.customerDiscountPct) * a.rateBps) / 1_000_000);

  const pickQuick = (n: number) => {
    setQty(n);
    setCustom('');
  };

  return (
    <>
      <PageHead
        title="Products"
        sub={`Everything your code works on. Your people pay ${a.customerDiscountPct}% less, and you earn ${a.commission} of what they pay.`}
      />

      <section className="panel p-6 sm:p-8" aria-labelledby="calc-h">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <h2 id="calc-h" className="st-h fg">If you sell…</h2>
            <p className="st-sub mt-1">Pick a number; the last column shows what that many of each earns you.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="How many sales">
            {QUICK.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={!custom && qty === n}
                onClick={() => pickQuick(n)}
                className={`btn btn-sm ${!custom && qty === n ? 'btn-ink' : 'btn-soft'}`}
              >
                {n}
              </button>
            ))}
            <input
              className="input tnum !h-9 !w-[96px] !px-4 text-center !text-[13px]"
              inputMode="numeric"
              placeholder="Other"
              aria-label="Another number of sales"
              value={custom}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                setCustom(v);
                if (Number(v) > 0) setQty(Number(v));
              }}
            />
          </div>
        </div>
      </section>

      <section className="panel mt-5 p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-2">
          <p className="text-[13px] fg-3">
            {products ? `${rows.length} ${rows.length === 1 ? 'size' : 'sizes'}` : 'Loading the store…'} · you earn on{' '}
            <span className="font-medium fg">{qty}</span> {qty === 1 ? 'sale' : 'sales'} of each
          </p>
          <label className="relative block w-full sm:w-64">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 fg-3" aria-hidden />
            <input className="input !h-10 !pl-10 !text-[14px]" placeholder="Search products" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search products" />
          </label>
        </div>

        {failed ? (
          <p className="p-2 text-[14px] fg-2">Couldn&apos;t load the products. Refresh to try again.</p>
        ) : !products ? (
          <div className="h-64 rounded-[18px]" style={{ background: 'var(--st-field)', opacity: 0.6 }} />
        ) : rows.length === 0 ? (
          <p className="p-2 text-[14px] fg-2">Nothing matches &quot;{query}&quot;.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="num hidden md:table-cell">Price</th>
                  <th className="num hidden md:table-cell">They pay</th>
                  <th className="num hidden sm:table-cell">You earn each</th>
                  <th className="num">You earn × {qty}</th>
                  <th className="hidden lg:table-cell" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <div className="flex items-center gap-3">
                        <Thumb src={r.image} />
                        <div className="min-w-0">
                          <p className="font-medium fg">
                            {r.name}
                            {r.size ? <span className="fg-2"> · {r.size}</span> : null}
                          </p>
                          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] fg-3">
                            <span className="tnum">{r.code}</span>
                            {r.stock === 'in' ? null : (
                              <span className={`pill ${r.stock === 'preorder' ? 'pill-info' : 'pill-bad'} !py-0`}>
                                {r.stock === 'preorder' ? 'Pre-order' : 'Out of stock'}
                              </span>
                            )}
                            <span className="md:hidden">
                              {rm(r.price)} → they pay {rm(pays(r.price))}
                            </span>
                          </p>
                          {/* Wrapped: .aff .btn's display outranks a utility class on the button itself. */}
                          <span className="mt-2 block lg:hidden">
                            <CopyButton text={link(r.slug)} label="Copy link" />
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="num hidden fg-2 md:table-cell">
                      {rm(r.price)}
                      {r.was ? <span className="block text-[12px] line-through fg-3">{rm(r.was)}</span> : null}
                    </td>
                    <td className="num hidden fg-2 md:table-cell">{rm(pays(r.price))}</td>
                    <td className="num hidden fg sm:table-cell">{rm(earns(r.price, 1))}</td>
                    <td className="num">
                      <span className="text-[15px] font-semibold fg">{rm(earns(r.price, qty))}</span>
                      <span className="block text-[12px] fg-3 sm:hidden">{rm(earns(r.price, 1))} each</span>
                    </td>
                    <td className="hidden text-right lg:table-cell">
                      <CopyButton text={link(r.slug)} label="Copy link" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="mt-4 px-2 text-[12px] leading-[17px] fg-3">
        Estimates at today&apos;s prices: the commission is worked on what the customer pays for the goods with your code, shipping left
        out. Each product&apos;s link opens its page with your code ready at checkout.
      </p>
    </>
  );
}
