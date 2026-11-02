'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown, ChevronRight, Truck, User } from 'lucide-react';
import type { HeaderMenuData } from '@/lib/header-menu';
import { GROUP_BUY_ENABLED } from '@/lib/features';
import { formatPrice } from '@/lib/utils';
import { menus } from './HeaderMenus';

/**
 * The phone menu, after Bayang's (our standard): it opens under the header,
 * which stays put, and holds the same menus as the desktop — Shop open with
 * its big links, every goal and the featured product; Research, Learn and
 * About as rows — on the same ink as the desktop panels, then Track order and
 * the account as the two big actions. Sections fold open like Bayang's
 * <details>; the content settles in 35ms apart.
 */
export function MobileMenu({
  data, visible, top, onClose, account,
}: {
  data: HeaderMenuData;
  visible: boolean;
  /** Where the header ends, so the menu opens under it. */
  top: number;
  onClose: () => void;
  account: { label: string; badge: string | null; initial: string | null };
}) {
  const list = menus(data);
  const rise = (i: number) => ({
    transitionDelay: visible ? `${60 + i * 35}ms` : '0ms',
    opacity: visible ? 1 : 0,
    transform: visible ? 'none' : 'translateY(6px)',
  });
  const big = [
    { href: '/products', label: 'All products' },
    ...(data.supplies ? [{ href: `/products?category=${data.supplies.slug}`, label: data.supplies.name }] : []),
    ...(GROUP_BUY_ENABLED ? [{ href: '/group-buy', label: 'Group Buy' }] : []),
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      className="md:hidden fixed inset-x-0 bottom-0 z-[60] overflow-y-auto overscroll-contain bg-primary text-white transition-opacity duration-200"
      style={{ top, opacity: visible ? 1 : 0 }}
    >
      <nav aria-label="Menu" className="px-5 pt-2 pb-6">
        {list.map((m, i) => (
          <details key={m.id} open={m.id === 'shop'} className="group/sec border-b border-white/10 transition-[opacity,transform] duration-300" style={rise(i)}>
            <summary className="flex cursor-pointer list-none items-center justify-between py-4 font-display text-[28px] font-semibold leading-10 [&::-webkit-details-marker]:hidden">
              {m.label}
              <ChevronDown className="h-6 w-6 text-white/60 transition-transform duration-200 group-open/sec:rotate-180" aria-hidden="true" />
            </summary>

            {m.id === 'shop' ? (
              <div className="grid gap-6 pb-6">
                <ul className="grid gap-1">
                  {big.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} onClick={onClose} className="block py-1 text-[20px] font-medium leading-7">{l.label}</Link>
                    </li>
                  ))}
                </ul>
                {data.categories.length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-white/55">By goal</p>
                    <ul className="grid gap-0.5">
                      {data.categories.map((c) => (
                        <li key={c.slug}>
                          <Link href={`/products?category=${c.slug}`} onClick={onClose} className="block py-1.5 text-[16px] leading-6 text-white/85">{c.name}</Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {data.feature && (
                  <Link href={`/products/${data.feature.slug}`} onClick={onClose} className="grid grid-cols-[72px_minmax(0,1fr)_20px] items-center gap-4 rounded-2xl bg-white/[0.07] p-3">
                    <span className="relative h-[72px] w-[72px] overflow-hidden rounded-xl bg-[#E9E9E9]">
                      <Image src={data.feature.imageUrl} alt={data.feature.name} fill sizes="72px" className="object-cover" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-medium uppercase tracking-[0.08em] text-white/55">Featured</span>
                      <span className="block truncate text-[15px] font-medium leading-6">{data.feature.code} · {data.feature.name}</span>
                      <span className="block text-[13px] text-white/60">from {formatPrice(data.feature.fromPrice)}</span>
                    </span>
                    <ChevronRight className="h-5 w-5 text-white/50" aria-hidden="true" />
                  </Link>
                )}
              </div>
            ) : 'rows' in m ? (
              <ul className="grid gap-3 pb-6">
                {m.rows.map((r) => (
                  <li key={r.href}>
                    <Link href={r.href} onClick={onClose} className="grid grid-cols-[48px_minmax(0,1fr)_20px] items-center gap-3.5">
                      <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/10">
                        <r.icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[15px] font-medium leading-6">{r.title}</span>
                        <span className="block truncate text-[13px] leading-5 text-white/60">{r.text}</span>
                      </span>
                      <ChevronRight className="h-5 w-5 text-white/50" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
                {m.more && (
                  <li>
                    <Link href={m.more.href} onClick={onClose} className="inline-flex items-center gap-1 pt-1 text-[14px] font-medium text-white/80">
                      {m.more.label} <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </li>
                )}
              </ul>
            ) : null}
          </details>
        ))}

        {/* The two things people come back for. */}
        <div className="mt-6 grid gap-2.5 transition-[opacity,transform] duration-300" style={rise(list.length)}>
          <Link href="/track" onClick={onClose} className="flex h-14 items-center justify-center gap-2 rounded-full bg-white text-[16px] font-semibold text-primary">
            <Truck className="h-5 w-5" aria-hidden="true" /> Track order
          </Link>
          <Link
            href="/account"
            onClick={onClose}
            className="flex h-14 items-center justify-center gap-2 rounded-full bg-white/15 text-[16px] font-semibold shadow-[inset_0_1px_0_rgb(255_255_255/0.28),inset_0_0_0_1px_rgb(255_255_255/0.14)]"
          >
            {account.initial ? (
              <span className="grid h-7 w-7 place-items-center rounded-full bg-success font-display text-[13px] font-bold text-primary">{account.initial}</span>
            ) : (
              <User className="h-5 w-5" aria-hidden="true" />
            )}
            {account.label}
            {account.badge && <span className="rounded-full bg-success px-2 py-0.5 text-[12px] font-semibold text-primary">{account.badge}</span>}
          </Link>
        </div>
      </nav>
    </div>
  );
}
