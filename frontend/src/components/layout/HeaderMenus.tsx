'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, BookOpen, Calculator, ChevronRight, CircleHelp, Info, RotateCcw, Truck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { HeaderMenuData } from '@/lib/header-menu';
import { GROUP_BUY_ENABLED } from '@/lib/features';
import { formatPrice } from '@/lib/utils';

/*
 * The header's menus, ported from Bayang (BayangWeb Header.astro +
 * islands/header-menus.ts) — our store standard: a few words in the middle of
 * the bar, each opening an ink-glass panel over a blurred page. Shop has big
 * links, the goals and a photo card; the others are rows with a tile. Open on
 * hover (fine pointers) or click, one at a time; Escape, the veil, or leaving
 * the trigger and its panel closes it. A dot marks the open menu, and the
 * section of the page you're on.
 */

export type Row = { href: string; title: string; text: string; icon: LucideIcon };
export type Menu =
  | { id: 'shop'; label: string; match: string[] }
  | { id: string; label: string; match: string[]; group: string; rows: Row[]; more?: { href: string; label: string } };

export function menus(data: HeaderMenuData): Menu[] {
  return [
    { id: 'shop', label: 'Shop', match: ['/products', '/group-buy'] },
    ...(data.research.length
      ? [{
          id: 'research', label: 'Research', match: ['/research'], group: 'Latest research',
          rows: data.research.map((r) => ({ href: `/research/${r.slug}`, title: r.title, text: r.dek, icon: BookOpen })),
          more: { href: '/research', label: 'All research' },
        }]
      : []),
    {
      id: 'learn', label: 'Learn', match: ['/calculator', '/guide', '/coa', '/faq'], group: 'Learn',
      rows: [
        { href: '/calculator', title: 'Reconstitution calculator', text: 'BAC water, concentration and draw volume for any vial.', icon: Calculator },
        { href: '/guide', title: 'Peptide guide', text: 'Reconstituting and storing research peptides.', icon: BookOpen },
        { href: '/coa', title: 'Certificates of Analysis', text: 'Third-party test results, batch by batch.', icon: BadgeCheck },
        { href: '/faq', title: 'Questions', text: 'Purity, shipping and how to order.', icon: CircleHelp },
      ],
    },
    {
      id: 'about', label: 'About', match: ['/about', '/shipping', '/return-policy'], group: 'Ascend MY',
      rows: [
        { href: '/about', title: 'About Ascend MY', text: 'Who we are and how we work.', icon: Info },
        { href: '/shipping', title: 'Shipping', text: 'Delivery across Malaysia.', icon: Truck },
        { href: '/return-policy', title: 'Returns', text: 'Our return policy.', icon: RotateCcw },
      ],
    },
  ];
}

const label = 'mb-3 text-[11px] font-medium uppercase tracking-[0.08em] text-white/55';

export function HeaderMenus({ data, pathname }: { data: HeaderMenuData; pathname: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const openedAt = useRef(0);
  const list = menus(data);
  const fine = () => matchMedia('(hover: hover) and (pointer: fine)').matches;
  // `at`: the event's timeStamp, so "just opened by hover" needs no clock read in render scope.
  const set = (id: string | null, at = 0) => {
    if (id && id !== open) openedAt.current = at;
    setOpen(id);
  };
  const close = () => setOpen(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const inSection = (m: Menu) => m.match.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  return (
    <>
      <ul className="flex items-center gap-4">
        {list.map((m) => {
          const isOpen = open === m.id;
          return (
            <li
              key={m.id}
              onPointerEnter={(e) => { if (!fine()) return; clearTimeout(timer.current); set(m.id, e.timeStamp); }}
              onPointerLeave={() => { if (!fine()) return; timer.current = window.setTimeout(close, 160); }}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`menu-${m.id}`}
                // A click right after hover opened it keeps it open instead of toggling it shut.
                onClick={(e) => set(isOpen && e.timeStamp - openedAt.current > 400 ? null : m.id, e.timeStamp)}
                className={`relative rounded-full px-3 py-1 text-[15px] font-medium leading-6 cursor-pointer after:absolute after:left-1/2 after:-bottom-0.5 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-current after:transition-opacity after:duration-150 hover:after:opacity-100 ${
                  isOpen || inSection(m) ? 'after:opacity-100' : 'after:opacity-0'
                }`}
              >
                {m.label}
              </button>

              {/* The panel: ink glass, centred under the bar. Fades, drops 8px and settles. */}
              <div
                id={`menu-${m.id}`}
                className={`absolute left-1/2 top-[calc(100%-8px)] z-20 rounded-3xl bg-[rgb(10_10_10/0.8)] p-6 text-white shadow-[0_32px_64px_rgb(10_10_10/0.22)] backdrop-blur-[40px] backdrop-saturate-150 transition-[opacity,translate,scale,visibility] ${
                  isOpen
                    ? 'visible -translate-x-1/2 translate-y-0 scale-100 opacity-100 duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]'
                    : 'invisible pointer-events-none -translate-x-1/2 -translate-y-2 scale-[0.985] opacity-0 duration-200'
                }`}
              >
                {m.id === 'shop' ? (
                  <ShopPanel data={data} onGo={close} />
                ) : 'rows' in m ? (
                  <div className="w-[min(480px,calc(100vw-48px))]">
                    <p className={label}>{m.group}</p>
                    <ul className="grid gap-3">
                      {m.rows.map((r) => (
                        <li key={r.href}>
                          <Link href={r.href} onClick={close} className="group/row grid grid-cols-[64px_minmax(0,1fr)_20px] items-center gap-4 rounded-2xl">
                            <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/10 transition-colors group-hover/row:bg-white/15">
                              <r.icon className="h-6 w-6" aria-hidden="true" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-[15px] font-medium leading-6">{r.title}</span>
                              <span className="block truncate text-[13px] leading-5 text-white/60">{r.text}</span>
                            </span>
                            <ChevronRight className="h-5 w-5 text-white/50 transition-[translate,color] duration-200 group-hover/row:translate-x-1 group-hover/row:text-white" aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {m.more && (
                      <Link href={m.more.href} onClick={close} className="mt-5 inline-flex items-center gap-1 text-[14px] font-medium text-white/80 hover:text-white">
                        {m.more.label} <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {/* The page blurs and dims behind an open menu; touching it closes. */}
      <div
        aria-hidden="true"
        onClick={close}
        onPointerEnter={() => { if (!fine()) return; clearTimeout(timer.current); timer.current = window.setTimeout(close, 120); }}
        className={`fixed inset-0 top-0 -z-10 bg-[rgb(10_10_10/0.18)] backdrop-blur-[20px] transition-[opacity,visibility] duration-200 ${
          open ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      />
    </>
  );
}

function ShopPanel({ data, onGo }: { data: HeaderMenuData; onGo: () => void }) {
  const big = [
    { href: '/products', label: 'All products' },
    ...(data.supplies ? [{ href: `/products?category=${data.supplies.slug}`, label: data.supplies.name }] : []),
    ...(GROUP_BUY_ENABLED ? [{ href: '/group-buy', label: 'Group Buy' }] : []),
  ];
  return (
    // Never wider than the window: the photo card joins from 1024px.
    <div className={`grid gap-8 grid-cols-2 ${data.feature ? 'w-[min(780px,calc(100vw-48px))] lg:grid-cols-[200px_220px_minmax(0,1fr)]' : 'w-[min(480px,calc(100vw-48px))]'}`}>
      <div>
        <p className={label}>Shop</p>
        <ul className="grid gap-1">
          {big.map((l) => (
            <li key={l.href}>
              <Link href={l.href} onClick={onGo} className="font-display text-[24px] font-semibold leading-8 transition-opacity hover:opacity-60">{l.label}</Link>
            </li>
          ))}
        </ul>
      </div>
      {data.categories.length > 0 && (
        <div>
          <p className={label}>By goal</p>
          <ul className="grid gap-1">
            {data.categories.map((c) => (
              <li key={c.slug}>
                <Link href={`/products?category=${c.slug}`} onClick={onGo} className="text-[15px] leading-7 transition-opacity hover:opacity-60">{c.name}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.feature && (
        <Link href={`/products/${data.feature.slug}`} onClick={onGo} className="group/card relative hidden lg:block aspect-[4/5] overflow-hidden rounded-2xl bg-[#E9E9E9]">
          <Image src={data.feature.imageUrl} alt={data.feature.name} fill sizes="300px" className="object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/card:scale-[1.04]" />
          <span className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(10_10_10/0.62),rgb(10_10_10/0)_45%)]" aria-hidden="true" />
          <span className="absolute left-4 top-4 grid text-[15px] leading-6">
            <span className="font-medium">{data.feature.code} · {data.feature.name}</span>
            <span className="text-white/70">from {formatPrice(data.feature.fromPrice)}</span>
          </span>
          <span className="absolute bottom-4 left-4 grid h-10 w-10 place-items-center rounded-full bg-[rgb(10_10_10/0.7)] backdrop-blur-md transition-transform duration-300 group-hover/card:translate-x-1" aria-hidden="true">
            <ChevronRight className="h-4 w-4" />
          </span>
        </Link>
      )}
    </div>
  );
}
