'use client';

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { LogOut, Moon, Store, Sun } from 'lucide-react';
import { useMemberSession, setMemberSession } from '@/lib/member-session';
import { memberLogin, memberRegister, memberResendVerification } from '@/lib/api';
import {
  apiError,
  checkAffiliateCode,
  getMyAffiliate,
  getProgramme,
  joinAffiliate,
  suggestAffiliateCode,
  updateMyAffiliate,
  type MyAffiliate,
  type Programme,
} from '@/lib/affiliate-api';
import { AffContext, Field, Notice, Tabs, useAffHref, useStoreOrigin } from './aff-ui';

const TABS = [
  { href: '/', label: 'Overview' },
  { href: '/orders', label: 'Orders' },
  { href: '/payouts', label: 'Payouts' },
  { href: '/settings', label: 'Settings' },
];

/* ── Theme: saved per browser, set before paint by the layout's script ── */

const THEME_KEY = 'ascend-aff-theme';
const THEME_EVENT = 'ascend-aff-theme';
function readTheme(): 'light' | 'dark' {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
function subscribeTheme(cb: () => void) {
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
}
function setTheme(t: 'light' | 'dark') {
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* storage blocked: this page only */
  }
  const root = document.querySelector('[data-affiliate-root]');
  if (t === 'dark') root?.setAttribute('data-theme', 'dark');
  else root?.removeAttribute('data-theme');
  window.dispatchEvent(new Event(THEME_EVENT));
}

function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => 'light' as const);
  const idx = theme === 'dark' ? 1 : 0;
  // Slides only when pressed: arriving in dark mode must not animate.
  const [pressed, setPressed] = useState(false);
  return (
    <div role="radiogroup" aria-label="Theme" className="relative flex rounded-full p-1.5" style={{ background: 'var(--st-panel)', boxShadow: 'var(--st-shadow)' }}>
      <span
        aria-hidden
        className="absolute left-1.5 top-1.5 h-9 w-9 rounded-full"
        style={{ background: 'var(--st-solid)', transform: `translateX(${idx * 40}px)`, transition: pressed ? 'transform 320ms cubic-bezier(.3,1.3,.5,1)' : undefined }}
      />
      {(['light', 'dark'] as const).map((t) => {
        const Icon = t === 'light' ? Sun : Moon;
        const on = theme === t;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${t === 'light' ? 'Light' : 'Dark'} theme`}
            onClick={() => (setPressed(true), setTheme(t))}
            className="relative z-10 flex h-9 w-9 items-center justify-center rounded-full"
            style={{ color: on ? 'var(--st-on-solid)' : 'var(--st-fg-3)', marginLeft: t === 'dark' ? 4 : 0 }}
          >
            <Icon className="h-[17px] w-[17px]" strokeWidth={1.8} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

function Logo() {
  const href = useAffHref();
  return (
    <Link href={href('/')} className="flex items-center gap-3" aria-label="Ascend Affiliate home">
      <span className="chip-ink h-[52px] w-[52px] rounded-[16px]" style={{ boxShadow: 'var(--st-shadow)' }}>
        <Image src="/images/pill-icon.png" alt="" width={26} height={26} className="aff-logo" />
      </span>
      <span className="hidden leading-tight sm:block">
        <span className="block text-[15px] font-medium fg">Ascend</span>
        <span className="block text-[12px] fg-3">Affiliate</span>
      </span>
    </Link>
  );
}

function AccountMenu({ name, email, onSignOut }: { name: string; email: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const store = useStoreOrigin();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '·';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-12 items-center justify-center rounded-[14px] text-[14px] font-semibold fg"
        style={{ background: 'linear-gradient(135deg,var(--st-lilac),var(--st-sky) 60%,var(--st-blush))', boxShadow: 'var(--st-shadow)' }}
      >
        {initials}
      </button>
      {open ? (
        <div role="menu" className="pop absolute right-0 top-[calc(100%+10px)] z-40 w-64 p-2">
          <div className="px-3 py-2">
            <p className="truncate text-[14px] font-medium fg">{name}</p>
            <p className="truncate text-[12px] fg-3">{email}</p>
          </div>
          <a role="menuitem" href={store} className="flex h-10 items-center gap-2.5 rounded-full px-3 text-[14px] fg-2 hover:bg-[var(--st-field)]">
            <Store className="h-4 w-4" aria-hidden /> Go to the store
          </a>
          <button
            role="menuitem"
            type="button"
            onClick={onSignOut}
            className="flex h-10 w-full items-center gap-2.5 rounded-full px-3 text-left text-[14px] fg-2 hover:bg-[var(--st-field)]"
          >
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ── The shell ── */

export function AffShell({ children }: { children: React.ReactNode }) {
  const { member, token, ready, signOut } = useMemberSession();
  // Held with the token it was loaded for, so signing in as someone else
  // never shows the previous account's figures while the new ones load.
  const [loaded, setLoaded] = useState<{ token: string; data: MyAffiliate | null; failed: boolean } | null>(null);
  const current = loaded && loaded.token === token ? loaded : null;
  const data = current?.data ?? null;
  const failed = current?.failed ?? false;

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      setLoaded({ token, data: await getMyAffiliate(), failed: false });
    } catch {
      setLoaded({ token, data: null, failed: true });
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let live = true;
    getMyAffiliate().then(
      (d) => live && setLoaded({ token, data: d, failed: false }),
      () => live && setLoaded({ token, data: null, failed: true })
    );
    return () => {
      live = false;
    };
  }, [token]);

  const affiliate = token ? data?.affiliate : null;
  const showTabs = !!affiliate && (affiliate.status === 'ACTIVE' || affiliate.status === 'PAUSED');

  let body: React.ReactNode;
  if (!ready) body = <Skeleton />;
  else if (!member || !token) body = <AuthPanel />;
  else if (failed) body = <Retry onRetry={reload} />;
  else if (!data) body = <Skeleton />;
  else if (!data.affiliate) body = <JoinPanel member={member} programme={data.programme} onJoined={reload} />;
  else if (data.affiliate.status === 'APPLIED') body = <WaitingPanel data={data} onChanged={reload} />;
  else if (data.affiliate.status === 'REJECTED') body = <ClosedPanel text="Your application wasn't approved. If you think that's a mistake, message us on WhatsApp." />;
  else body = <AffContext.Provider value={{ member, data, reload }}>{children}</AffContext.Provider>;

  return (
    <div className="mx-auto max-w-[1180px] px-4 pb-16 sm:px-6">
      <header className="sticky top-0 z-30 -mx-4 mb-6 px-4 pt-4 pb-3 sm:-mx-6 sm:mb-8 sm:px-6 sm:pt-6" style={{ background: 'linear-gradient(var(--st-canvas) 70%, transparent)' }}>
        <div className="flex items-center justify-between gap-3">
          <Logo />
          {showTabs ? (
            <div className="hidden min-w-0 md:block">
              <Tabs items={TABS} />
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <ThemeSwitch />
            {member && token ? <AccountMenu name={affiliate?.fullName || member.displayName} email={member.email} onSignOut={signOut} /> : null}
          </div>
        </div>
        {showTabs ? (
          <div className="mt-3 md:hidden">
            <Tabs items={TABS} />
          </div>
        ) : null}
      </header>
      {body}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid gap-5">
      <div className="h-[52px] w-64 rounded-full" style={{ background: 'var(--st-panel)', opacity: 0.6 }} />
      <div className="panel h-[220px]" style={{ opacity: 0.6 }} />
    </div>
  );
}

function Retry({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="panel mx-auto max-w-[480px] p-8 text-center">
      <p className="st-h fg">Couldn&apos;t load your account</p>
      <p className="st-sub mt-2">Check your connection and try again.</p>
      <button type="button" className="btn btn-ink mt-6" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

function ClosedPanel({ text }: { text: string }) {
  return (
    <div className="panel mx-auto max-w-[520px] p-8">
      <p className="st-h fg">Ascend Affiliate</p>
      <p className="mt-2 text-[14px] leading-[21px] fg-2">{text}</p>
    </div>
  );
}

/* ── Signed out: sign in or create the store account ── */

function AuthPanel() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [programme, setProgramme] = useState<Programme | null>(null);
  const store = useStoreOrigin();
  const uid = useId();

  useEffect(() => {
    getProgramme().then(setProgramme, () => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'signup' && password.length < 8) return setError('Use at least 8 characters for your password.');
    setBusy(true);
    try {
      if (mode === 'signup') await memberRegister({ email, password, displayName: name.trim() });
      const r = await memberLogin({ email, password });
      setMemberSession(r.token, r.member);
    } catch (err) {
      setError(apiError(err, mode === 'signup' ? 'Could not create your account.' : 'Wrong email or password.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)]">
      <section className="panel p-6 sm:p-10">
        <h1 className="st-title fg">Share Ascend.<br />Earn on every order.</h1>
        <p className="mt-4 max-w-[520px] text-[15px] leading-[23px] fg-2">
          Get your own code. The people you share it with get {programme ? `${programme.customerDiscountPct}%` : 'a discount'} off at
          ascendpeptides.my, and you earn {programme ? programme.commission : 'a commission'} of every order they pay for — paid to your bank.
        </p>
        <ol className="mt-8 grid gap-3 sm:grid-cols-3">
          {[
            ['tint-lilac', '1', 'Sign in', 'Use your Ascend MY store account, or make one.'],
            ['tint-sky', '2', 'Pick your code', 'Something short your people will remember.'],
            ['tint-mint', '3', 'Share and earn', 'Ask for a payout whenever you have a balance.'],
          ].map(([tint, n, h, t]) => (
            <li key={n} className={`tint ${tint}`}>
              <span className="chip-ink h-9 w-9 rounded-[11px] text-[14px] font-semibold">{n}</span>
              <p className="mt-4 text-[16px] font-medium fg">{h}</p>
              <p className="mt-1 text-[13px] leading-[18px] fg-2">{t}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel p-6 sm:p-8" aria-labelledby={`${uid}-h`}>
        <h2 id={`${uid}-h`} className="st-h fg">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h2>
        <p className="st-sub mt-1">{mode === 'signin' ? 'The same account you use on the store.' : 'One account for the store and Ascend Affiliate.'}</p>
        <form onSubmit={submit} className="mt-6 grid gap-4" noValidate>
          {mode === 'signup' ? (
            <Field label="Your name">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </Field>
          ) : null}
          <Field label="Email">
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </Field>
          <Field label="Password" help={mode === 'signup' ? 'At least 8 characters.' : undefined}>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
            />
          </Field>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <button type="submit" className="btn btn-ink mt-2 w-full" disabled={busy || !email || !password || (mode === 'signup' && !name.trim())}>
            {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-[13px]">
          <button type="button" className="fg-2 underline-offset-4 hover:underline" onClick={() => (setMode(mode === 'signin' ? 'signup' : 'signin'), setError(''))}>
            {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
          {mode === 'signin' ? (
            <a className="fg-3 underline-offset-4 hover:underline" href={`${store}/account/forgot-password`}>
              Forgot password?
            </a>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/* ── Signed in, not an affiliate yet ── */

const TERMS = [
  'Commission is earned on the goods (after the discount, not shipping) once an order is paid.',
  'If an order is refunded or cancelled, its commission is taken back — even after it was paid out.',
  'You can ask for a payout any time you have a balance; it is paid after a short hold so refunds land first.',
  'Your own orders never earn commission.',
  'Share honestly: no medical claims, no spam, no posting the code on coupon sites. We may pause a code that breaks this.',
];

function JoinPanel({ member, programme, onJoined }: { member: { displayName: string; email: string; emailVerified: boolean }; programme: Programme; onJoined: () => Promise<void> }) {
  const [fullName, setFullName] = useState(member.displayName);
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState('');
  const [code, setCode] = useState('');
  const [codeState, setCodeState] = useState<{ code: string; ok: boolean; reason: string | null } | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  const suggested = useRef(false);

  // One suggestion from their name, until they type their own.
  useEffect(() => {
    if (suggested.current || code) return;
    suggested.current = true;
    suggestAffiliateCode(member.displayName).then((r) => setCode((c) => c || r.code), () => {});
  }, [member.displayName, code]);

  useEffect(() => {
    const c = code.trim();
    if (c.length < 4) return;
    const t = setTimeout(() => {
      checkAffiliateCode(c).then((r) => setCodeState({ code: r.code, ok: r.available, reason: r.reason }), () => {});
    }, 300);
    return () => clearTimeout(t);
  }, [code]);

  if (!programme.enabled) return <ClosedPanel text="The affiliate programme isn't open right now. Please check back soon." />;

  const normalised = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const codeError = normalised.length > 0 && normalised.length < 4 ? 'At least 4 letters or numbers.' : codeState && codeState.code === normalised && !codeState.ok ? codeState.reason : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await joinAffiliate({ fullName: fullName.trim(), phone: phone.trim(), channel: channel.trim() || undefined, code: normalised, acceptTerms: true });
      await onJoined();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
      <section className="panel p-6 sm:p-8">
        <h1 className="st-title fg">Join Ascend Affiliate</h1>
        <p className="mt-2 text-[14px] leading-5 fg-2">
          Your code gives {programme.customerDiscountPct}% off. You earn {programme.commission} of every paid order made with it.
        </p>

        {!member.emailVerified ? (
          <div className="mt-6">
            <Notice tone="warn">
              Confirm your email first — we sent a link to <strong>{member.email}</strong>.{' '}
              {resent ? (
                'Sent again.'
              ) : (
                <button type="button" className="underline underline-offset-2" onClick={() => memberResendVerification(member.email).then(() => setResent(true), () => {})}>
                  Send it again
                </button>
              )}
            </Notice>
          </div>
        ) : null}

        <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2" noValidate>
          <Field label="Full name" help="As on your bank account — payouts go to it.">
            <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
          </Field>
          <Field label="WhatsApp number">
            <input className="input" type="tel" inputMode="tel" placeholder="012 345 6789" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Your code" error={codeError} help={codeState?.ok && codeState.code === normalised ? 'Available.' : 'Letters and numbers, 4 to 16.'}>
              <input className="input uppercase tracking-[0.06em]" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} aria-invalid={!!codeError} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Where will you share it? (optional)" help="Your Instagram or TikTok, a group, a gym — anything that helps us approve you.">
              <input className="input" value={channel} onChange={(e) => setChannel(e.target.value)} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-[18px] p-3" style={{ background: 'var(--st-field)' }}>
              <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--st-solid)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span className="text-[13px] leading-[19px] fg-2">I agree to how Ascend Affiliate works (below).</span>
            </label>
          </div>
          {error ? (
            <div className="sm:col-span-2">
              <Notice tone="bad">{error}</Notice>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <button
              type="submit"
              className="btn btn-ink w-full sm:w-auto"
              disabled={busy || !agree || !member.emailVerified || fullName.trim().length < 2 || phone.trim().length < 8 || normalised.length < 4 || !!codeError}
            >
              {busy ? 'Sending…' : 'Apply'}
            </button>
          </div>
        </form>
      </section>

      <aside className="panel p-6 sm:p-8">
        <h2 className="st-h fg">How it works</h2>
        <ul className="mt-4 grid gap-3">
          {TERMS.map((t) => (
            <li key={t} className="flex gap-3 text-[13px] leading-[19px] fg-2">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: 'var(--st-s-purple)' }} />
              {t}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/* ── Applied, waiting for the team ── */

function WaitingPanel({ data, onChanged }: { data: MyAffiliate; onChanged: () => Promise<void> }) {
  const a = data.affiliate!;
  const [code, setCode] = useState(a.code);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const changed = code.toUpperCase().replace(/[^A-Z0-9]/g, '') !== a.code;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await updateMyAffiliate({ code });
      await onChanged();
      setMsg({ tone: 'ok', text: 'Code changed.' });
    } catch (err) {
      setMsg({ tone: 'bad', text: apiError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-[640px] gap-5">
      <section className="panel p-6 sm:p-8">
        <span className="pill pill-warn">Waiting for approval</span>
        <h1 className="st-title fg mt-4">Thanks, {a.fullName.split(' ')[0]}.</h1>
        <p className="mt-2 text-[14px] leading-[21px] fg-2">
          We&apos;ll look at your application soon. Your code is held for you and starts working the moment you&apos;re approved — you&apos;ll see your
          dashboard here.
        </p>
        <div className="tint tint-lilac mt-6">
          <p className="st-label">Your code</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className="input max-w-[260px] uppercase tracking-[0.06em]" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Your code" />
            <button type="button" className="btn btn-ink btn-sm" disabled={!changed || busy} onClick={save}>
              {busy ? 'Saving…' : 'Change'}
            </button>
          </div>
          <p className="mt-2 text-[12px] fg-2">You can change it until you&apos;re approved.</p>
        </div>
        {msg ? (
          <div className="mt-4">
            <Notice tone={msg.tone}>{msg.text}</Notice>
          </div>
        ) : null}
      </section>
    </div>
  );
}
