'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowRight, Check, Copy, Landmark, Link2, Pause, Play } from 'lucide-react';
import { getProducts } from '@/lib/api';
import { getEffectivePrice } from '@/lib/utils';
import type { Programme } from '@/lib/affiliate-api';
import type { Product } from '@/types';

/**
 * The signed-out affiliate site's showcase: why join, one idea a slide, on a
 * dark Ascend panel. Every figure is the live programme (discount, rate,
 * hold) or the store's own products and prices; the sample code and balance
 * are illustrations of screens, never a promise of income. Slides change on
 * their own every few seconds with a soft blur-dissolve, pause on hover or
 * focus (and from the pause button), and keep still for reduced motion.
 */

const DWELL_MS = 5200;
const SAMPLE_CODE = 'AH4827';

const rm = (sen: number) =>
  `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: sen % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

interface Pick {
  name: string;
  size: string | null;
  image: string | null;
  price: number;
}

export function AuthShowcase({ programme, onJoin }: { programme: Programme | null; onJoin: () => void }) {
  const d = programme?.customerDiscountPct ?? 5;
  const bps = programme?.commissionBps ?? 500;
  const rate = programme?.commission ?? '5%';
  const hold = programme?.holdDays ?? 3;
  const pays = (sen: number) => Math.round((sen * (100 - d)) / 100);
  const earn = (sen: number) => Math.round((pays(sen) * bps) / 10_000);

  // Real products: the store's featured sizes with photos, best first.
  const [products, setProducts] = useState<Pick[]>([]);
  useEffect(() => {
    let live = true;
    getProducts({ limit: 100 }).then(
      (r) => {
        if (!live) return;
        const picks = r.data
          .filter((p: Product) => p.featured)
          .concat(r.data.filter((p: Product) => !p.featured))
          .flatMap((p: Product) => {
            const v = p.variants.find((x) => x.active && x.imageUrl);
            return v ? [{ name: p.name, size: v.size, image: v.imageUrl, price: getEffectivePrice(v) }] : [];
          })
          .slice(0, 3);
        setProducts(picks);
      },
      () => {}
    );
    return () => {
      live = false;
    };
  }, []);

  const hero = products[0] ?? { name: 'Your order', size: null, image: null, price: 21_000 };

  const slides = useMemo(
    () =>
      [
        {
          key: 'earn',
          title: 'Earn on every order your people pay for.',
          sub: `Your own code: ${d}% off for them, ${rate} of what they pay for you — paid to your bank.`,
          visual: <EarnCurve earn={earn} />,
        },
        {
          key: 'save',
          title: 'They save. You earn.',
          sub: `One code at checkout takes ${d}% off their order and puts ${rate} of it in your balance.`,
          visual: <Receipt item={hero} d={d} pays={pays} earn={earn} />,
        },
        products.length >= 2
          ? {
              key: 'products',
              title: 'Every product in the store earns.',
              sub: 'The whole Ascend MY range — and your Products page shows what each one pays you.',
              visual: <ProductTiles products={products} earn={earn} />,
            }
          : null,
        {
          key: 'link',
          title: 'One link does the work.',
          sub: 'Share it anywhere. It remembers your code for 30 days and offers it at checkout in one tap.',
          visual: <LinkVisual />,
        },
        {
          key: 'payout',
          title: 'Paid straight to your bank.',
          sub: hold ? `Ask whenever you have a balance. No minimum. Paid after a ${hold}-day hold.` : 'Ask whenever you have a balance. No minimum.',
          visual: <PayoutVisual hold={hold} />,
        },
        {
          key: 'join',
          title: 'Free to join. Ready in a minute.',
          sub: 'Use your Ascend MY account or make one, pick your code, and start sharing.',
          visual: <JoinVisual onJoin={onJoin} />,
        },
      ].filter(Boolean) as { key: string; title: string; sub: string; visual: React.ReactNode }[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [d, bps, rate, hold, products]
  );

  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false); // hover or focus
  const [paused, setPaused] = useState(false); // the button
  const [cycle, setCycle] = useState(0); // restarts the progress bar
  const current = index % slides.length;
  const still = held || paused;

  useEffect(() => {
    if (still) return;
    const t = setTimeout(() => {
      setIndex((i) => (i + 1) % slides.length);
      setCycle((c) => c + 1);
    }, DWELL_MS);
    return () => clearTimeout(t);
  }, [current, still, slides.length, cycle]);

  const go = (i: number) => {
    setIndex(i);
    setCycle((c) => c + 1);
  };

  return (
    <section
      className="aff-show relative isolate flex min-h-[540px] flex-col overflow-hidden rounded-[28px] p-6 text-white sm:p-10 lg:h-full lg:min-h-0"
      aria-roledescription="carousel"
      aria-label="Why join Ascend Affiliate"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => (setHeld(false), setCycle((c) => c + 1))}
      onFocus={() => setHeld(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && (setHeld(false), setCycle((c) => c + 1))}
    >
      {/* Progress: one bar a slide, the current one filling. */}
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => go(i)}
              aria-label={`Slide ${i + 1} of ${slides.length}: ${s.title}`}
              aria-current={i === current ? 'true' : undefined}
              className="group h-6 flex-1 cursor-pointer py-2.5"
            >
              <span className="block h-1 overflow-hidden rounded-full bg-white/15">
                <span
                  key={i === current ? `on-${cycle}` : 'off'}
                  className={`block h-full rounded-full bg-white ${i < current ? 'w-full' : i === current ? 'aff-show-fill' : 'w-0'}`}
                  // Held (hover, focus, pause): the bar stops where it is.
                  style={i === current ? { animationPlayState: still ? 'paused' : 'running' } : undefined}
                />
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => (setPaused((p) => !p), setCycle((c) => c + 1))}
          aria-label={paused ? 'Play the slides' : 'Pause the slides'}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/10 text-white/80 hover:bg-white/20"
        >
          {paused ? <Play className="h-3.5 w-3.5" aria-hidden /> : <Pause className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </div>

      {/* The slides, stacked; the current one dissolves in. */}
      <div className="aff-show-stage relative mt-8 min-h-0 flex-1">
        {slides.map((s, i) => (
          <div
            key={s.key}
            className={`aff-show-slide absolute inset-0 flex flex-col ${i === current ? 'is-on' : ''}`}
            aria-hidden={i !== current}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${slides.length}`}
            // Off-screen slides can't take focus.
            {...(i !== current ? { inert: true } : {})}
          >
            <h2 className="aff-show-in aff-show-title st-display max-w-[560px] font-semibold tracking-[-0.02em]">
              {s.title}
            </h2>
            <p className="aff-show-in aff-show-d1 aff-show-sub mt-4 max-w-[480px] text-white/65">{s.sub}</p>
            <div className="aff-show-in aff-show-d2 aff-show-visual mt-8 min-h-0 flex-1">
              <FitBox>{s.visual}</FitBox>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        /* Type steps with the window's height, in whole pixels. */
        .aff-show-title { font-size: 34px; line-height: 40px; }
        .aff-show-sub { font-size: 15px; line-height: 23px; }
        @media (min-width: 640px) { .aff-show-title { font-size: 44px; line-height: 50px; } }
        @media (min-width: 1024px) and (max-height: 820px) {
          .aff-show { padding: 28px 32px; }
          .aff-show-stage { margin-top: 20px; }
          .aff-show-title { font-size: 34px; line-height: 40px; }
          .aff-show-sub { margin-top: 10px; font-size: 14px; line-height: 21px; }
          .aff-show-visual { margin-top: 20px; }
        }
        @media (min-width: 1024px) and (max-height: 680px) {
          .aff-show-title { font-size: 30px; line-height: 36px; }
        }
        .aff-show { background: radial-gradient(120% 80% at 100% 0%, rgb(34 197 94 / 0.16), transparent 55%), #0a0a0a; box-shadow: 0 0 0 1px rgb(255 255 255 / 0.06); }
        .aff-show-slide { opacity: 0; filter: blur(10px); transform: scale(1.015); pointer-events: none; transition: opacity 650ms cubic-bezier(0.16, 1, 0.3, 1), filter 650ms cubic-bezier(0.16, 1, 0.3, 1), transform 650ms cubic-bezier(0.16, 1, 0.3, 1); }
        .aff-show-slide.is-on { opacity: 1; filter: blur(0); transform: none; pointer-events: auto; }
        .aff-show-slide .aff-show-in { opacity: 0; transform: translateY(8px); transition: opacity 600ms ease-out, transform 600ms cubic-bezier(0.16, 1, 0.3, 1); }
        .aff-show-slide.is-on .aff-show-in { opacity: 1; transform: none; }
        .aff-show-slide.is-on .aff-show-d1 { transition-delay: 90ms; }
        .aff-show-slide.is-on .aff-show-d2 { transition-delay: 180ms; }
        .aff-show-fill { width: 0; animation: aff-show-fill ${DWELL_MS}ms linear forwards; }
        @keyframes aff-show-fill { to { width: 100%; } }
        @media (prefers-reduced-motion: reduce) {
          .aff-show-slide, .aff-show-slide .aff-show-in { transition: none; filter: none; transform: none; }
          .aff-show-fill { animation: none; width: 100%; }
        }
      `}</style>
    </section>
  );
}

/**
 * Sits a slide's graphic at the bottom of the space left for it, and scales
 * it down — only ever down — when the window is too short to show it whole.
 */
function FitBox({ children }: { children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const fit = () => {
      const natural = i.offsetHeight; // unscaled: transforms don't change layout size
      setScale(natural > 0 ? Math.min(1, o.clientHeight / natural) : 1);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={outer} className="relative h-full w-full overflow-hidden">
      <div
        ref={inner}
        className="absolute bottom-0 left-0 origin-bottom-left"
        style={{ width: `${100 / scale}%`, transform: scale < 1 ? `scale(${scale})` : undefined }}
      >
        {children}
      </div>
    </div>
  );
}

/* ── The visuals ── */

function EarnCurve({ earn }: { earn: (sen: number) => number }) {
  const scale = [1, 10, 50];
  const amounts = scale.map((n) => earn(20_000) * n);
  const W = 460;
  const H = 120;
  const pts = amounts.map((a, i) => ({ x: 12 + (i * (W - 24)) / 2, y: H - 10 - (a / amounts[2]) * (H - 24) }));
  const line = pts.reduce((acc, p, i) => {
    if (!i) return `M${p.x},${p.y}`;
    const q = pts[i - 1];
    const mx = (q.x + p.x) / 2;
    return `${acc} C${mx},${q.y} ${mx},${p.y} ${p.x},${p.y}`;
  }, '');
  return (
    <div className="w-full rounded-[22px] bg-white/[0.04] p-5 ring-1 ring-white/10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[12px] text-white/55">On one RM 200 order</p>
          <p className="st-display mt-1 whitespace-nowrap text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[#22c55e] sm:text-[40px]">+{rm(earn(20_000))}</p>
        </div>
        <p className="text-right text-[12px] text-white/55">The same order, again and again</p>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 block h-auto w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id="aff-show-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${pts[2].x},${H} L${pts[0].x},${H} Z`} fill="url(#aff-show-fill)" />
        <path d={line} fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={i === 2 ? 5 : 3.5} fill="#0a0a0a" stroke="#22c55e" strokeWidth="2.5" />
        ))}
      </svg>
      <div className="mt-2 grid grid-cols-3 text-[12px]">
        {scale.map((n, i) => (
          <div key={n} className={i === 0 ? 'text-left' : i === 2 ? 'text-right' : 'text-center'}>
            <p className={`st-display text-[15px] font-semibold tabular-nums ${i === 2 ? 'text-[#22c55e]' : 'text-white'}`}>{rm(amounts[i])}</p>
            <p className="text-white/45">
              {n} {n === 1 ? 'order' : 'orders'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Receipt({ item, d, pays, earn }: { item: Pick; d: number; pays: (s: number) => number; earn: (s: number) => number }) {
  return (
    // Room below and to the right for the badge, so the fit (FitBox) counts it.
    <div className="relative w-full max-w-[480px] pb-6 pr-0 sm:pr-5">
      <div className="rounded-[22px] bg-white p-5 text-[#0a0a0a] shadow-[0_30px_60px_-30px_rgb(0_0_0/0.8)]">
        <p className="text-[12px] text-[#525252]">Checkout · ascendpeptides.my</p>
        <div className="mt-4 flex items-center gap-3">
          <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-[12px] bg-[#f1f1f1]">
            {item.image ? <Image src={item.image} alt="" fill sizes="48px" className="object-cover" /> : null}
          </span>
          <p className="min-w-0 flex-1 truncate text-[14px] font-medium">
            {item.name}
            {item.size ? <span className="text-[#525252]"> · {item.size}</span> : null}
          </p>
          <p className="text-[14px] tabular-nums">{rm(item.price)}</p>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-[12px] bg-[#22c55e]/10 px-3 py-2 text-[13px]">
          <span className="font-medium text-[#15803d]">
            Code {SAMPLE_CODE} · {d}% off
          </span>
          <span className="tabular-nums text-[#15803d]">−{rm(item.price - pays(item.price))}</span>
        </div>
        <div className="mt-4 flex items-baseline justify-between border-t border-[#e5e5e5] pt-3">
          <span className="text-[13px] text-[#525252]">They pay</span>
          <span className="st-display text-[22px] font-semibold tabular-nums">{rm(pays(item.price))}</span>
        </div>
      </div>
      {/* What it does for you: the toast that lands in your balance. */}
      <div className="absolute bottom-0 right-4 flex items-center gap-2 rounded-full bg-[#22c55e] px-4 py-2.5 text-[14px] font-semibold text-[#052e16] shadow-[0_16px_30px_-12px_rgb(34_197_94/0.6)] sm:right-0">
        <Check className="h-4 w-4" aria-hidden /> You earn {rm(earn(item.price))}
      </div>
    </div>
  );
}

function ProductTiles({ products, earn }: { products: Pick[]; earn: (s: number) => number }) {
  return (
    <div className="grid w-full grid-cols-3 gap-3">
      {products.map((p) => (
        <div key={`${p.name}-${p.size}`} className="overflow-hidden rounded-[18px] bg-white/[0.05] ring-1 ring-white/10">
          <div className="relative aspect-square bg-white">
            {p.image ? <Image src={p.image} alt="" fill sizes="(max-width: 640px) 30vw, 160px" className="object-contain p-3" /> : null}
          </div>
          <div className="p-3">
            <p className="truncate text-[13px] font-medium">{p.name}</p>
            <p className="text-[12px] text-white/50">{rm(p.price)}</p>
            <p className="mt-2 text-[13px] font-semibold tabular-nums text-[#22c55e]">+{rm(earn(p.price))}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function LinkVisual() {
  return (
    <div className="grid w-full items-end gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
      <div className="rounded-[22px] bg-white/[0.04] p-5 ring-1 ring-white/10">
        <p className="text-[12px] text-white/55">Your link</p>
        <div className="mt-2 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[#0a0a0a]">
          <Link2 className="h-4 w-4 shrink-0 text-[#525252]" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">ascendpeptides.my/?ref={SAMPLE_CODE}</span>
          <Copy className="h-4 w-4 shrink-0 text-[#525252]" aria-hidden />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-[12px] text-white/70">
          <span className="rounded-full bg-white/10 px-3 py-1">Remembered 30 days</span>
          <span className="rounded-full bg-white/10 px-3 py-1">Works on every product</span>
        </div>
      </div>
      {/* A phone at checkout. */}
      <div className="mx-auto w-[200px] rounded-[30px] bg-[#1a1a1a] p-2 ring-1 ring-white/15 sm:mx-0">
        <div className="rounded-[24px] bg-white p-3 text-[#0a0a0a]">
          <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-[#e5e5e5]" />
          <p className="text-[11px] text-[#525252]">Checkout</p>
          <div className="mt-2 h-2 w-3/4 rounded-full bg-[#f1f1f1]" />
          <div className="mt-1.5 h-2 w-1/2 rounded-full bg-[#f1f1f1]" />
          <div className="mt-3 rounded-[12px] bg-[#f5f5f5] p-2.5 text-[11px] leading-[15px]">
            Code <b>{SAMPLE_CODE}</b> from your link.{' '}
            <span className="font-semibold text-[#3155d9]">Apply it</span>
          </div>
          <div className="mt-3 rounded-full bg-[#0a0a0a] py-2 text-center text-[11px] font-semibold text-white">Place order</div>
        </div>
      </div>
    </div>
  );
}

function PayoutVisual({ hold }: { hold: number }) {
  const steps = [{ t: 'You ask', s: 'any time' }, ...(hold ? [{ t: `${hold}-day hold`, s: 'refunds land first' }] : []), { t: 'Paid', s: 'to your bank' }];
  return (
    <div className="w-full rounded-[22px] bg-white/[0.04] p-5 ring-1 ring-white/10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[12px] text-white/55">Your balance</p>
          <p className="st-display mt-1 text-[36px] font-semibold leading-none tabular-nums">RM 142.50</p>
        </div>
        <span className="rounded-full bg-white px-5 py-3 text-[14px] font-semibold text-[#0a0a0a]">Ask for a payout</span>
      </div>
      <ol className="mt-6 flex items-center gap-2">
        {steps.map((s, i) => (
          <li key={s.t} className="flex flex-1 items-center gap-2">
            <div className={`flex-1 rounded-[14px] px-3 py-2.5 ${i === steps.length - 1 ? 'bg-[#22c55e] text-[#052e16]' : 'bg-white/10'}`}>
              <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                {i === steps.length - 1 ? <Landmark className="h-3.5 w-3.5" aria-hidden /> : null}
                {s.t}
              </p>
              <p className={`text-[11px] ${i === steps.length - 1 ? 'text-[#052e16]/70' : 'text-white/50'}`}>{s.s}</p>
            </div>
            {i < steps.length - 1 ? <ArrowRight className="h-4 w-4 shrink-0 text-white/40" aria-hidden /> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

function JoinVisual({ onJoin }: { onJoin: () => void }) {
  const steps = ['Create your account, or sign in', 'Pick your code', 'Share it — and earn'];
  return (
    <div className="w-full">
      <ul className="grid gap-2">
        {steps.map((s) => (
          <li key={s} className="flex items-center gap-3 rounded-[16px] bg-white/[0.05] px-4 py-3 ring-1 ring-white/10">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#22c55e] text-[#052e16]">
              <Check className="h-3.5 w-3.5" aria-hidden />
            </span>
            <span className="text-[15px]">{s}</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onJoin} className="mt-5 inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-6 py-3.5 text-[15px] font-semibold text-[#0a0a0a] hover:bg-white/90">
        Create my account <ArrowRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
