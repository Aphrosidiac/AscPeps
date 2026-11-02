'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BadgeCheck,
  Ban,
  CircleDollarSign,
  Eye,
  KeyRound,
  Landmark,
  Link2,
  Lock,
  PauseCircle,
  Share2,
  ShoppingBag,
  Ticket,
  UserX,
  Wallet,
  XCircle,
} from 'lucide-react';
import { STATE_LABEL, type OrderState } from '@/lib/affiliate-api';
import { PageHead, STATE_TONE, rm, useAff, useAffHref, useStoreOrigin } from '../aff-ui';

/**
 * The affiliate guide (affiliate.ascendpeptides.my/guide): everything about
 * how the programme works, one section at a time — a tab per topic, linkable
 * as /guide#payouts. Every number comes from the affiliate's own account and
 * the live programme settings, and every rule is one the system enforces
 * (docs/affiliate.md) — nothing here promises more than the code does.
 */

const SECTIONS = [
  { id: 'start', label: 'How it works' },
  { id: 'code', label: 'Code & link' },
  { id: 'earning', label: 'Earning' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'refunds', label: 'Refunds' },
  { id: 'details', label: 'Your details' },
  { id: 'rules', label: 'Rules' },
  { id: 'faq', label: 'Questions' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const readHash = (): SectionId => {
  const h = window.location.hash.slice(1);
  return (SECTIONS.some((s) => s.id === h) ? h : 'start') as SectionId;
};

export default function AffiliateGuide() {
  const section = useSyncExternalStore(subscribeHash, readHash, () => 'start' as SectionId);
  const go = (id: SectionId) => {
    // The hash is the state: back/forward and a shared link land on the same section.
    window.history.pushState(null, '', `#${id}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    window.scrollTo({ top: 0 });
  };
  // On a phone the sections are a sideways strip: keep the open one in view.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    // Sideways only (scrollIntoView would move the page too).
    // Again whenever the strip changes size (it settles after the page loads).
    const n = nav.current;
    if (!n) return;
    const center = () => {
      const a = n.querySelector<HTMLElement>('[aria-current="page"]');
      if (!a || n.scrollWidth <= n.clientWidth) return;
      n.scrollLeft += a.getBoundingClientRect().left - n.getBoundingClientRect().left - (n.clientWidth - a.offsetWidth) / 2;
    };
    center();
    const ro = new ResizeObserver(center);
    ro.observe(n);
    return () => ro.disconnect();
  }, [section]);
  const i = SECTIONS.findIndex((s) => s.id === section);
  const next = SECTIONS[i + 1];

  return (
    <>
      <PageHead title="Guide" sub="Everything about being an Ascend affiliate, one topic at a time" />
      <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav
          ref={nav}
          aria-label="Guide sections"
          className="panel -mx-1 flex min-w-0 gap-1 overflow-x-auto p-2 [scrollbar-width:none] lg:sticky lg:top-[104px] lg:mx-0 lg:flex-col [&::-webkit-scrollbar]:hidden"
        >
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={(e) => (e.preventDefault(), go(s.id))}
              aria-current={s.id === section ? 'page' : undefined}
              className="shrink-0 whitespace-nowrap rounded-full px-4 py-2.5 text-[14px] font-medium transition-colors duration-[120ms]"
              style={s.id === section ? { background: 'var(--st-solid)', color: 'var(--st-on-solid)' } : { color: 'var(--st-fg-2)' }}
            >
              {s.label}
            </a>
          ))}
        </nav>

        <article className="panel min-w-0 p-6 sm:p-10" aria-labelledby={`guide-${section}`}>
          {section === 'start' ? <Start /> : null}
          {section === 'code' ? <CodeAndLink /> : null}
          {section === 'earning' ? <Earning /> : null}
          {section === 'payouts' ? <Payouts /> : null}
          {section === 'refunds' ? <Refunds /> : null}
          {section === 'details' ? <Details /> : null}
          {section === 'rules' ? <Rules /> : null}
          {section === 'faq' ? <Faq /> : null}
          {next ? (
            <div className="mt-10 flex justify-end border-t pt-6" style={{ borderColor: 'var(--st-hair)' }}>
              <button type="button" className="btn btn-soft" onClick={() => go(next.id)}>
                Next: {next.label} <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : null}
        </article>
      </div>
    </>
  );
}

/* ── Building blocks ── */

function H({ id, children, lead }: { id: SectionId; children: React.ReactNode; lead: React.ReactNode }) {
  return (
    <header className="mb-8">
      <h2 id={`guide-${id}`} className="st-title fg !text-[32px] !leading-[40px]">{children}</h2>
      <p className="mt-3 max-w-[640px] text-[16px] leading-[25px] fg-2">{lead}</p>
    </header>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <h3 className="st-h fg mb-3 mt-10">{children}</h3>;
}

/** A short point, with an icon that says what it's about. */
function Point({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="chip-ink mt-0.5 h-10 w-10 rounded-full" aria-hidden>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-medium fg">{title}</p>
        <p className="mt-0.5 text-[14px] leading-[21px] fg-2">{children}</p>
      </div>
    </li>
  );
}

function Points({ children }: { children: React.ReactNode }) {
  return <ul className="grid gap-5 sm:grid-cols-2">{children}</ul>;
}

/** "What you'll see": a piece of the real screen, drawn with the portal's own parts. */
function Screen({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <figure className="my-6 flex flex-col">
      <div className="flex-1 rounded-[22px] p-4 sm:p-6" style={{ background: 'var(--st-canvas)', boxShadow: 'inset 0 0 0 1px var(--st-hair)' }}>
        {children}
      </div>
      <figcaption className="mt-2 px-2 text-[12px] fg-3">{caption}</figcaption>
    </figure>
  );
}

function Callout({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: React.ReactNode }) {
  return (
    <div
      className="my-6 rounded-[18px] px-5 py-4 text-[14px] leading-[21px]"
      style={{ background: tone === 'warn' ? 'var(--st-warn-soft)' : 'var(--st-info-soft)', color: tone === 'warn' ? 'var(--st-warn)' : 'var(--st-info)' }}
    >
      {children}
    </div>
  );
}

/** The numbers every section uses: this affiliate's, from the live programme. */
function useNumbers() {
  const { data } = useAff();
  const a = data.affiliate!;
  const d = a.customerDiscountPct;
  const rateBps = a.rateBps;
  const hold = data.programme.holdDays;
  const earn = (goods: number) => Math.round((goods * (100 - d) * rateBps) / 1_000_000);
  const pays = (goods: number) => Math.round((goods * (100 - d)) / 100);
  return { a, d, rate: a.commission, rateBps, hold, earn, pays, code: a.code };
}

/* ── How it works ── */

function Start() {
  const { d, rate, hold, earn } = useNumbers();
  const steps = [
    { icon: Share2, title: 'You share', text: 'Your code or your link, anywhere you like.' },
    { icon: ShoppingBag, title: 'They buy', text: `${d}% off their order with your code.` },
    { icon: BadgeCheck, title: 'Order is paid', text: 'Your commission is counted.' },
    { icon: CircleDollarSign, title: 'You earn', text: `${rate} of what they paid for the goods.` },
    { icon: Landmark, title: 'Paid to your bank', text: hold ? `Ask any time; paid after a ${hold}-day hold.` : 'Ask any time.' },
  ];
  return (
    <>
      <H id="start" lead={`You get your own discount code. Anyone who uses it gets ${d}% off at Ascend MY, and you earn ${rate} of every paid order made with it — paid to your bank.`}>
        How it works
      </H>

      {/* The journey, left to right (top to bottom on a phone). */}
      <ol className="relative grid gap-4 sm:grid-cols-5 sm:gap-3">
        <span aria-hidden className="absolute left-5 top-5 bottom-5 w-px sm:hidden" style={{ background: 'var(--st-hair)' }} />
        <span aria-hidden className="absolute left-[10%] right-[10%] top-6 hidden h-px sm:block" style={{ background: 'var(--st-hair)' }} />
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex gap-4 sm:flex-col sm:items-center sm:text-center">
            <span
              className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12"
              style={i === steps.length - 2 ? { background: 'var(--st-ok)', color: '#fff' } : { background: 'var(--st-solid)', color: 'var(--st-on-solid)' }}
            >
              <s.icon className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <div className="sm:mt-3">
              <p className="text-[15px] font-medium fg">{s.title}</p>
              <p className="mt-0.5 text-[13px] leading-[19px] fg-2">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 grid gap-3 sm:grid-cols-3">
        <div className="tint tint-sky">
          <p className="st-label fg-2">Your people get</p>
          <p className="st-fig mt-1 fg">{d}% off</p>
          <p className="mt-1 text-[12px] fg-2">every order with your code</p>
        </div>
        <div className="tint tint-mint">
          <p className="st-label fg-2">You earn</p>
          <p className="st-fig mt-1 fg">{rate}</p>
          <p className="mt-1 text-[12px] fg-2">e.g. {rm(earn(20_000))} on an RM 200 order</p>
        </div>
        <div className="tint tint-sky">
          <p className="st-label fg-2">It costs you</p>
          <p className="st-fig mt-1 fg">Nothing</p>
          <p className="mt-1 text-[12px] fg-2">no fee, no minimum to sell</p>
        </div>
      </div>

      <Sub>Where things are</Sub>
      <Points>
        <Point icon={Wallet} title="Overview">Your balance, your code and link, and your latest orders.</Point>
        <Point icon={ShoppingBag} title="Products">Every product with what you earn on it, and a link for each.</Point>
        <Point icon={Ticket} title="Orders">Every order made with your code and what it earned.</Point>
        <Point icon={Landmark} title="Payouts">Ask for your money, and every change to your balance.</Point>
        <Point icon={KeyRound} title="Settings">Your bank account and contact details.</Point>
      </Points>
    </>
  );
}

/* ── Code & link ── */

function CodeAndLink() {
  const { d, code } = useNumbers();
  const store = useStoreOrigin();
  const link = `${store.replace(/^https?:\/\//, '')}/?ref=${code}`;
  return (
    <>
      <H id="code" lead="There are two ways to send people to us with your discount: your code, and your link. Both earn you the same.">
        Your code &amp; link
      </H>

      <div className="grid gap-4 md:grid-cols-2">
        <Screen caption="Your code — they type it at checkout.">
          <div className="panel p-5">
            <p className="st-label">Your code</p>
            <p className="st-display mt-1 text-[30px] font-semibold tracking-[0.04em] fg">{code}</p>
            <p className="mt-1 text-[13px] fg-2">{d}% off for anyone who uses it at checkout.</p>
          </div>
        </Screen>
        <Screen caption="Your link — opens the store, and checkout offers your code.">
          <div className="panel p-5">
            <p className="st-label">Your link</p>
            <p className="mt-1 break-all text-[14px] font-medium fg">{link}</p>
            <div className="mt-3 rounded-[14px] px-3 py-2.5 text-[13px]" style={{ background: 'var(--st-field)' }}>
              <span className="fg-2">At checkout: </span>
              <span className="fg">Code {code} from your link. </span>
              <span className="font-medium underline underline-offset-2" style={{ color: 'var(--st-info)' }}>Apply it</span>
            </div>
          </div>
        </Screen>
      </div>

      <Sub>How the link works</Sub>
      <Points>
        <Point icon={Link2} title="Remembered for 30 days">Once someone opens your link, their browser keeps your code for 30 days, even if they leave and come back.</Point>
        <Point icon={ShoppingBag} title="One tap at checkout">Checkout shows your code with an Apply button. It’s never applied without them pressing it.</Point>
        <Point icon={Share2} title="Links to one product">On Products, every item has its own link with your code — handy when you’re talking about one thing.</Point>
        <Point icon={Ticket} title="Or they just type it">Your code works typed in at checkout too, link or no link.</Point>
      </Points>

      <Callout>
        The link is kept in the browser they opened it in. If they open it on their phone and buy on a laptop, they type your code instead.
      </Callout>

      <Sub>Where your code works</Sub>
      <Points>
        <Point icon={BadgeCheck} title="Every store order">Anything in the store at ascendpeptides.my.</Point>
        <Point icon={Ban} title="Not Group Buy">Group Buy prices are already cut, so codes don’t apply there.</Point>
        <Point icon={Ticket} title="One code per order">An order takes one code. If they use another one (like a welcome code), yours isn’t on that order.</Point>
        <Point icon={UserX} title="Not your own orders">Your code won’t work when you buy for yourself — see Rules.</Point>
      </Points>
    </>
  );
}

/* ── Earning ── */

const STATES: { s: OrderState; text: string }[] = [
  { s: 'AWAITING_PAYMENT', text: 'Ordered, not paid yet. Shows what it will earn; nothing is counted until it’s paid.' },
  { s: 'EARNED', text: 'Paid. Your commission is in your balance.' },
  { s: 'PART_REFUNDED', text: 'Some of it was refunded. The same share of your commission comes off.' },
  { s: 'REFUNDED', text: 'Refunded in full. The commission comes off your balance.' },
  { s: 'CANCELLED', text: 'Cancelled. It earns nothing.' },
];

function Earning() {
  const { d, rate, earn, pays } = useNumbers();
  const [goods, setGoods] = useState(20_000);
  const discount = goods - pays(goods);
  return (
    <>
      <H id="earning" lead={`You earn ${rate} of what your customer pays for the goods — after their ${d}% discount, without shipping. It's counted the moment the order is paid.`}>
        Earning
      </H>

      <figure className="rounded-[22px] p-5 sm:p-7" style={{ background: 'var(--st-solid)', color: 'var(--st-on-solid)' }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <label className="block min-w-[220px] flex-1">
            <span className="text-[13px] opacity-70">Try it: an order of goods worth</span>
            <span className="st-display mt-1 block text-[32px] font-semibold tnum">{rm(goods)}</span>
            <input
              type="range"
              min={5_000}
              max={200_000}
              step={1_000}
              value={goods}
              onChange={(e) => setGoods(Number(e.target.value))}
              className="mt-3 w-full"
              style={{ accentColor: 'var(--st-ok)' }}
              aria-label="Order value"
            />
          </label>
          <div className="text-right">
            <p className="text-[13px] opacity-70">You earn</p>
            <p className="st-display text-[40px] font-semibold leading-none tnum" style={{ color: '#4ade80' }}>+{rm(earn(goods))}</p>
          </div>
        </div>

        {/* The order, split: their discount, what they pay, and your share of it. */}
        <div className="mt-6 flex h-4 w-full overflow-hidden rounded-full" style={{ background: 'rgb(255 255 255 / 0.12)' }} aria-hidden>
          <span style={{ width: `${(discount / goods) * 100}%`, background: 'rgb(255 255 255 / 0.35)' }} />
          <span style={{ width: `${(pays(goods) / goods) * 100 - (earn(goods) / goods) * 100}%` }} />
          <span style={{ width: `${(earn(goods) / goods) * 100}%`, background: '#22c55e' }} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-[13px]">
          <div>
            <p className="opacity-70">Their discount</p>
            <p className="mt-0.5 font-medium tnum">−{rm(discount)} ({d}%)</p>
          </div>
          <div>
            <p className="opacity-70">They pay</p>
            <p className="mt-0.5 font-medium tnum">{rm(pays(goods))}</p>
          </div>
          <div className="text-right">
            <p className="opacity-70">Your {rate}</p>
            <p className="mt-0.5 font-medium tnum" style={{ color: '#4ade80' }}>{rm(earn(goods))}</p>
          </div>
        </div>
        <figcaption className="mt-5 text-[12px] opacity-60">Shipping is never counted. Products shows this for every item.</figcaption>
      </figure>

      <Sub>When it counts</Sub>
      <Points>
        <Point icon={BadgeCheck} title="Only paid orders">An order earns once it’s paid. Until then it shows as Awaiting payment.</Point>
        <Point icon={Lock} title="Your rate is locked per order">An order earns at the rate you had when it was placed, even if your rate changes later.</Point>
        <Point icon={CircleDollarSign} title="No limit">Every paid order with your code earns, with no cap and no minimum.</Point>
        <Point icon={Eye} title="Private by design">You see each order’s number, date and what it earned — never who bought it.</Point>
      </Points>

      <Sub>What each order status means</Sub>
      <Screen caption="These are the labels on your Orders page.">
        <ul className="grid gap-3">
          {STATES.map(({ s, text }) => (
            <li key={s} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className={`pill ${STATE_TONE[s]} w-[150px] justify-center`}>{STATE_LABEL[s]}</span>
              <span className="min-w-0 flex-1 text-[14px] leading-[20px] fg-2">{text}</span>
            </li>
          ))}
        </ul>
      </Screen>
    </>
  );
}

/* ── Payouts ── */

function Payouts() {
  const { hold } = useNumbers();
  const href = useAffHref();
  const steps = [
    { day: 'Day 0', title: 'You ask', text: 'Press Ask for a payout. It asks for your whole available balance.' },
    ...(hold
      ? [{ day: `Days 1–${hold}`, title: 'On hold', text: `${hold} ${hold === 1 ? 'day' : 'days'} so any refund lands before we pay.` }]
      : []),
    { day: hold ? `Day ${hold}` : 'Then', title: 'Ready to pay', text: 'We check it, and transfer it from Ascend’s bank to yours.' },
    { day: 'Done', title: 'Paid', text: 'Marked paid here, with the transfer reference if there is one.' },
  ];
  return (
    <>
      <H id="payouts" lead={`Your balance is yours to ask for whenever it's above zero. We pay it to your bank ${hold ? `after a ${hold}-day hold, so refunds land first` : 'once we have checked it'}.`}>
        Payouts
      </H>

      {/* The payout's journey. */}
      <ol className={`grid gap-3 ${steps.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
        {steps.map((s, i) => (
          <li key={s.title} className="relative rounded-[22px] p-5" style={i === steps.length - 1 ? { background: 'var(--st-ok-soft)' } : { background: 'var(--st-field)' }}>
            <p className="text-[12px] font-medium" style={{ color: i === steps.length - 1 ? 'var(--st-ok)' : 'var(--st-fg-3)' }}>{s.day}</p>
            <p className="mt-1 text-[16px] font-medium fg">{s.title}</p>
            <p className="mt-1 text-[13px] leading-[19px] fg-2">{s.text}</p>
            {i < steps.length - 1 ? (
              <ArrowRight className="absolute -right-[13px] top-1/2 z-10 hidden h-[18px] w-[18px] -translate-y-1/2 rounded-full p-0.5 sm:block" style={{ background: 'var(--st-panel)', color: 'var(--st-fg-3)' }} aria-hidden />
            ) : null}
          </li>
        ))}
      </ol>

      <div className="mt-2 grid gap-4 md:grid-cols-2">
        <Screen caption="On Overview: the button asks for everything available.">
          <div className="panel p-5">
            <p className="st-label">Your balance</p>
            <p className="st-big mt-1 fg !text-[32px]">RM 22.56</p>
            <span className="btn btn-ink mt-4 pointer-events-none">Ask for a payout · RM 22.56</span>
          </div>
        </Screen>
        <Screen caption="Then, until it's paid.">
          <div className="panel p-5">
            <p className="st-label">Your balance</p>
            <p className="st-big mt-1 fg !text-[32px]">RM 22.56</p>
            <div className="mt-4 rounded-[18px] px-4 py-3" style={{ background: 'var(--st-warn-soft)', color: 'var(--st-warn)' }}>
              <p className="text-[14px] font-medium">RM 22.56 payout on its way</p>
              <p className="mt-0.5 text-[13px]">Asked 3 Nov · paid from {hold ? `${3 + hold} Nov` : '3 Nov'}</p>
            </div>
          </div>
        </Screen>
      </div>

      <Sub>The rules</Sub>
      <Points>
        <Point icon={Landmark} title="Bank details first">Add your bank account in Settings. We check it before it’s used.</Point>
        <Point icon={Wallet} title="One at a time">You can ask again once the last one is paid. Anything you earn meanwhile waits for the next.</Point>
        <Point icon={CircleDollarSign} title="No minimum">Ask for any amount above zero.</Point>
        <Point icon={Ban} title="A refund in the hold comes off">We pay the smaller of what you asked and your balance on the day. If refunds take it to nothing, the payout is cancelled.</Point>
        <Point icon={PauseCircle} title="Paused code, paused payouts">If your code is paused, payouts wait until it’s back on.</Point>
        <Point icon={Eye} title="Everything is on record">Payouts lists every payout and every change to your balance.</Point>
      </Points>

      <p className="mt-8 text-[14px] fg-2">
        Ready? <Link href={href('/')} className="font-medium underline underline-offset-2 fg">Go to Overview</Link> to ask for a payout.
      </p>
    </>
  );
}

/* ── Refunds ── */

function Refunds() {
  const { earn } = useNumbers();
  const first = earn(20_000);
  const second = earn(26_000);
  const rows = [
    { what: 'Order ASC0001 paid', change: first, balance: first },
    { what: 'Payout to your bank', change: -first, balance: 0 },
    { what: 'Order ASC0001 refunded', change: -first, balance: -first },
    { what: 'Order ASC0002 paid', change: second, balance: second - first },
  ];
  const max = Math.max(...rows.map((r) => Math.abs(r.balance)), 1);
  return (
    <>
      <H id="refunds" lead="If an order is refunded, the commission it earned comes back off your balance — the same share as the refund. Usually that's before you're paid; sometimes it's after.">
        Refunds
      </H>

      <Points>
        <Point icon={Ban} title="Full refund">All of that order’s commission comes off.</Point>
        <Point icon={CircleDollarSign} title="Part refund">A tenth of the order back takes a tenth of its commission back.</Point>
        <Point icon={XCircle} title="Cancelled orders">Earn nothing; if it was counted, it comes off.</Point>
        <Point icon={Wallet} title="Before your payout">A payout in its hold simply pays less.</Point>
      </Points>

      <Sub>After a payout: your balance can go below zero</Sub>
      <p className="mb-4 max-w-[640px] text-[14px] leading-[21px] fg-2">
        If an order is refunded after its commission was paid to you, your balance goes negative. You don&apos;t pay anything back — your next
        commission covers it first. An example:
      </p>
      <Screen caption="How it looks on your Payouts page, with the balance after each change.">
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.what} className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_100px_200px]">
              <span className="text-[14px] fg">{r.what}</span>
              <span className="text-right text-[14px] font-medium tnum" style={{ color: r.change < 0 ? 'var(--st-bad)' : 'var(--st-ok)' }}>
                {r.change > 0 ? '+' : ''}
                {rm(r.change)}
              </span>
              {/* The balance, either side of zero. */}
              <span className="col-span-2 flex items-center gap-2 sm:col-span-1">
                <span className="relative h-3 flex-1 rounded-full" style={{ background: 'var(--st-field)' }} aria-hidden>
                  <span className="absolute left-1/2 top-[-3px] h-[18px] w-px" style={{ background: 'var(--st-fg-3)' }} />
                  <span
                    className="absolute top-0 h-3 rounded-full"
                    style={{
                      background: r.balance < 0 ? 'var(--st-bad)' : 'var(--st-ok)',
                      width: `${(Math.abs(r.balance) / max) * 50}%`,
                      ...(r.balance < 0 ? { right: '50%' } : { left: '50%' }),
                    }}
                  />
                </span>
                <span className="w-[76px] text-right text-[13px] tnum" style={{ color: r.balance < 0 ? 'var(--st-bad)' : 'var(--st-fg-2)' }}>
                  {rm(r.balance)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Screen>
      <Callout>
        A negative balance just means the next orders fill it back up before you can ask for a payout. Nothing is ever taken from your bank.
      </Callout>
    </>
  );
}

/* ── Your details ── */

function Details() {
  return (
    <>
      <H id="details" lead="Your bank account, name, WhatsApp number and where you share are locked once you're in. To change them, you send a request and we approve it — so a payout can never go somewhere we haven't checked.">
        Your details
      </H>

      {/* The request's three states, as Settings shows them. */}
      <div className="grid gap-4 md:grid-cols-3">
        <Screen caption="Locked. Press Edit.">
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-medium fg">Bank details</p>
              <span className="btn btn-soft btn-sm pointer-events-none">Edit</span>
            </div>
            <div className="input mt-3 flex items-center opacity-60">Maybank</div>
          </div>
        </Screen>
        <Screen caption="Change it, and send the request.">
          <div className="panel p-4">
            <p className="text-[15px] font-medium fg">Bank details</p>
            <div className="input mt-3 flex items-center" style={{ boxShadow: 'inset 0 0 0 1px var(--st-s-purple)' }}>CIMB Bank</div>
            <span className="btn btn-ink btn-sm mt-3 pointer-events-none">Request change</span>
          </div>
        </Screen>
        <Screen caption="Waiting for us. Then it's yours.">
          <div className="panel p-4">
            <div className="rounded-[14px] px-3 py-2.5 text-[13px]" style={{ background: 'var(--st-warn-soft)', color: 'var(--st-warn)' }}>
              <p className="font-medium">Change waiting for approval</p>
              <p className="mt-0.5">Bank: Maybank → CIMB Bank</p>
            </div>
            <p className="mt-3 text-[12px] fg-3">Your old details stay in use until it&apos;s approved.</p>
          </div>
        </Screen>
      </div>

      <Sub>Good to know</Sub>
      <Points>
        <Point icon={Wallet} title="One request at a time">Edit again before we answer and your new request replaces the old one — we only see your latest.</Point>
        <Point icon={Ban} title="Changed your mind?">Press Withdraw it on Settings. Nothing changes.</Point>
        <Point icon={UserX} title="If we say no">You’ll see why on Settings, and your details stay as they were.</Point>
        <Point icon={Landmark} title="Name must match the account">The account holder name has to match the bank account, or we can’t pay it.</Point>
        <Point icon={Lock} title="Bank details can't be removed">Only changed — so there’s always somewhere to pay you.</Point>
        <Point icon={Ticket} title="Your code stays">Once your code is live it doesn’t change: every link you shared uses it. Message us if it really must.</Point>
      </Points>
    </>
  );
}

/* ── Rules ── */

function Rules() {
  const { d } = useNumbers();
  return (
    <>
      <H id="rules" lead="A few rules keep the programme fair. Each one is built into the system, so there are no surprises.">
        Rules
      </H>
      <Points>
        <Point icon={UserX} title="Your code isn't for your own orders">
          It’s refused when the order has your email or phone number — including versions of them, like name+shop@gmail.com or a number written
          with +60.
        </Point>
        <Point icon={Ticket} title="One code per order">{`An order with your code gets ${d}% off and can't use another code as well.`}</Point>
        <Point icon={Ban} title="Store orders only">Group Buy orders don’t take codes.</Point>
        <Point icon={PauseCircle} title="We can pause a code">A paused code does nothing at checkout. What you’ve earned stays yours, and payouts wait until it’s back on.</Point>
        <Point icon={Lock} title="If the programme closes">All codes stop working at checkout. Your balance is kept.</Point>
        <Point icon={BadgeCheck} title="Only real, paid orders count">Cancelled, refunded or test orders don’t earn.</Point>
      </Points>
    </>
  );
}

/* ── Questions ── */

function Faq() {
  const { d, rate, hold, earn, code } = useNumbers();
  const qs: [string, React.ReactNode][] = [
    ['How much will I earn?', `${rate} of what your customer pays for the goods, after their ${d}% off. On an RM 200 order that's ${rm(earn(20_000))}. Products shows it for every item.`],
    ['When does an order count?', 'As soon as it’s paid. Unpaid orders show what they will earn, and count once paid.'],
    ['When do I get paid?', hold ? `Ask for a payout any time your balance is above zero. It's payable ${hold} ${hold === 1 ? 'day' : 'days'} after you ask, then we transfer it to your bank and mark it paid.` : 'Ask for a payout any time your balance is above zero; we transfer it to your bank and mark it paid.'],
    ['Is there a minimum payout?', 'No. Any balance above zero.'],
    ['Can I see who bought with my code?', 'No — only the order number, date, status and what it earned. Customers’ details stay private.'],
    ['Someone used my link but no commission shows. Why?', 'The order may be unpaid yet, used a different code, or was placed on another device without your code. If they used your link, checkout offers your code — they still have to press Apply.'],
    ['Why is my balance negative?', 'An order was refunded after its commission was paid to you. Your next commission covers it first; nothing is taken from your bank.'],
    ['Can I use my own code?', 'No. It’s refused on orders with your email or phone number.'],
    ['Can I change my code?', `Not once it's live — your links all use ${code}. Message us if it really has to change.`],
    ['How do I change my bank account?', 'Settings → Edit → Request change. We approve it, then payouts go to the new account.'],
    ['What if my rate changes?', 'Orders already placed keep the rate they were placed at; new orders use the new one.'],
  ];
  return (
    <>
      <H id="faq" lead="Quick answers. Each section has the detail.">
        Questions
      </H>
      <div className="grid gap-2">
        {qs.map(([q, a]) => (
          <details key={q} className="group rounded-[18px] px-5 py-4" style={{ background: 'var(--st-field)' }}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium fg">
              {q}
              <span aria-hidden className="text-[18px] leading-none fg-3 transition-transform duration-[120ms] group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 text-[14px] leading-[21px] fg-2">{a}</p>
          </details>
        ))}
      </div>
    </>
  );
}
