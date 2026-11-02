import { useId } from 'react';

/**
 * The affiliate popup's worked example: what one order with the code earns,
 * and what more orders add up to. Worked from the live settings (discount,
 * default rate) the same way the API books it — the goods after the code's
 * discount, times the rate — so it never promises more than the programme
 * pays. Ink card, Signal Green for the money (Ascend's colour for a good
 * outcome); the curve draws itself once as the popup opens.
 */
const EXAMPLE = 20_000; // RM 200 of goods, shipping left out
const SCALE = [1, 10, 50];

// The chart's box. x is evenly spaced per step; y follows the money.
const W = 300;
const H = 96;
const PAD = 10;

// "RM 200", "RM 9.50", "RM 1,425": cents only when there are some.
const rm = (sen: number) =>
  `RM ${(sen / 100).toLocaleString('en-MY', { minimumFractionDigits: sen % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export function AffiliateEarnings({ discountPct, rateBps, className = 'mt-5' }: { discountPct: number; rateBps: number; className?: string }) {
  // Its own id: the homepage and the popup can both be on one page.
  const fillId = `aff-earn-fill-${useId().replace(/:/g, '')}`;
  const pays = Math.round((EXAMPLE * (100 - discountPct)) / 100);
  const earn = (orders: number) => Math.round((pays * orders * rateBps) / 10_000);
  const amounts = SCALE.map(earn);
  const top = amounts[amounts.length - 1] || 1;

  const pts = amounts.map((a, i) => ({
    x: PAD + (i * (W - PAD * 2)) / (SCALE.length - 1),
    y: H - PAD - (a / top) * (H - PAD * 2),
  }));
  // A smooth rise through the points (horizontal tangents keep it from overshooting).
  const line = pts.reduce((d, p, i) => {
    if (i === 0) return `M${p.x},${p.y}`;
    const q = pts[i - 1];
    const mx = (q.x + p.x) / 2;
    return `${d} C${mx},${q.y} ${mx},${p.y} ${p.x},${p.y}`;
  }, '');
  const area = `${line} L${pts[pts.length - 1].x},${H} L${pts[0].x},${H} Z`;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-primary p-5 text-white ${className}`}
      aria-label={`Example: on an ${rm(EXAMPLE)} order your people pay ${rm(pays)} and you earn ${rm(earn(1))}. Ten orders earn ${rm(earn(10))}, fifty earn ${rm(earn(50))}.`}
      role="img"
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="text-[12px] text-white/60">You earn on one {rm(EXAMPLE)} order</p>
          <p className="mt-1 whitespace-nowrap font-display text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-success sm:text-[40px]">+{rm(earn(1))}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-[12px] text-white/60">They pay</p>
          <p className="mt-1 font-display text-[18px] font-semibold tabular-nums">{rm(pays)}</p>
          <p className="text-[12px] text-white/60">{discountPct}% off with your code</p>
        </div>
      </div>

      <div className="mt-5">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22C55E" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#22C55E" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${fillId})`} className="aff-earn-area" />
          <path d={line} fill="none" stroke="#22C55E" strokeWidth="2.5" strokeLinecap="round" pathLength={1} className="aff-earn-line" />
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={i === pts.length - 1 ? 5 : 3.5} fill="#0A0A0A" stroke="#22C55E" strokeWidth="2.5" />
          ))}
        </svg>
        <div className="mt-2 grid grid-cols-3">
          {SCALE.map((n, i) => (
            <div key={n} className={i === 0 ? 'text-left' : i === SCALE.length - 1 ? 'text-right' : 'text-center'}>
              <p className={`font-display text-[15px] font-semibold tabular-nums ${i === SCALE.length - 1 ? 'text-success' : 'text-white'}`}>{rm(amounts[i])}</p>
              <p className="text-[11px] text-white/50">
                {n} {n === 1 ? 'order' : 'orders'}
              </p>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .aff-earn-line { stroke-dasharray: 1; stroke-dashoffset: 1; animation: aff-earn-draw 900ms cubic-bezier(0.16, 1, 0.3, 1) 200ms forwards; }
        .aff-earn-area { opacity: 0; animation: aff-earn-fade 600ms ease-out 500ms forwards; }
        @keyframes aff-earn-draw { to { stroke-dashoffset: 0; } }
        @keyframes aff-earn-fade { to { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .aff-earn-line { animation: none; stroke-dashoffset: 0; }
          .aff-earn-area { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
