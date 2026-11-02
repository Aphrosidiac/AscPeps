'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Gift, KeyRound, Loader2, Mail, MailCheck, User } from 'lucide-react';
import { useStoreSettings } from '@/lib/store-settings';
import type { GroupBuySummary } from '@/types';
import { memberForgotPassword, memberLogin, memberRegister, memberResendVerification, memberResetPassword } from '@/lib/api';
import { setMemberSession } from '@/lib/member-session';
import { useNow } from '@/lib/use-now';
import { signupGroupBuy } from '@/lib/group-buy-api';
import { countdown, rewardOff } from '@/lib/group-buy';
import { GROUP_BUY_ENABLED } from '@/lib/features';
import { safeNextPath } from '@/app/account/safe-next';
import { Field, PasswordField, MIN_PASSWORD, apiError, inputCls } from './fields';

export type AuthBatch = Pick<GroupBuySummary, 'slug' | 'label' | 'title' | 'phase' | 'opensAt' | 'closesAt' | 'reward'>;
type Mode = 'signin' | 'signup' | 'forgot' | 'reset';
type Where = 'store' | 'group-buy';

const ROUTES: Record<Where, Record<'signin' | 'signup' | 'forgot', string>> = {
  store: { signin: '/account/login', signup: '/account/register', forgot: '/account/forgot-password' },
  'group-buy': { signin: '/group-buy/sign-in', signup: '/group-buy/join', forgot: '/group-buy/forgot-password' },
};

// Everything here is something an account really does today — keep it that
// way: no promises the system doesn't keep.
const PERKS = GROUP_BUY_ENABLED
  ? [
      'Every Group Buy order in one place, with its live batch timeline',
      'Your name and email filled in at checkout',
      'Sign-up reward codes shown on screen, not only in your inbox',
    ]
  : ['Your name and email filled in at checkout'];

function rewardWhere(r: NonNullable<AuthBatch['reward']>) {
  return r.scope === 'GROUP_BUY' ? 'your batch order' : r.scope === 'STORE' ? 'your next store order' : 'your next order';
}

/**
 * Sign in, create account, forgot password and reset password: one screen for
 * both the store (/account/…) and the Group Buy portal (/group-buy/…) so each
 * keeps its own chrome. Creating an account signs you straight in, and while a
 * batch is open it can also put you on that batch's list (which is what issues
 * its reward code).
 */
export function AuthScreen({ mode, where, batch }: { mode: Mode; where: Where; batch: AuthBatch | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get('next'), where === 'group-buy' ? '/group-buy' : '/account');
  const q = `?next=${encodeURIComponent(next)}`;
  const routes = ROUTES[where];
  const signup = mode === 'signup';
  const listOpen = !!batch && (batch.phase === 'LIVE' || batch.phase === 'UPCOMING');
  const reward = listOpen ? batch.reward : null;

  // useId, not fixed ids: Next keeps the previous route mounted (hidden), so
  // two of these screens can be in the page at once.
  const uid = useId();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [joinList, setJoinList] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState<null | { name: string; email: string; joined: boolean; inbox: boolean }>(null);
  const [resent, setResent] = useState('');

  const longEnough = password.length >= MIN_PASSWORD;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (signup && !longEnough) { setError('Use at least 8 characters for your password.'); return; }
    setLoading(true);
    try {
      if (signup) {
        await memberRegister({ email, password, displayName: name.trim() });
        // The register answer is the same whether or not the address already
        // had an account. Signing in with what was just typed tells them
        // apart without revealing anything: a new account gets in, an old
        // one with another password falls back to "check your inbox".
        let signedIn = false;
        try {
          const { token, member } = await memberLogin({ email, password });
          setMemberSession(token, member);
          signedIn = true;
        } catch { /* existing account: inbox screen below */ }
        let joined = false;
        if (signedIn && listOpen && joinList) {
          try {
            await signupGroupBuy(batch.slug, { email, name: name.trim(), source: 'PAGE' });
            joined = true;
          } catch { /* the account matters more than the list; they can join from the batch page */ }
        }
        setDone({ name: name.trim(), email, joined, inbox: !signedIn });
        router.refresh();
      } else {
        const { token, member } = await memberLogin({ email, password });
        setMemberSession(token, member);
        router.push(next);
        router.refresh();
      }
    } catch (err) {
      setError(apiError(err, signup ? 'Could not create that account. Please try again.' : 'Invalid email or password'));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (!email) { setError('Type your email above first.'); return; }
    try { setResent((await memberResendVerification(email)).message); }
    catch (err) { setError(apiError(err, 'Could not send that right now.')); }
  };

  return (
    <div className="gbp-auth mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-6 lg:py-8 lg:flex lg:items-center lg:min-h-[calc(100svh-98px)]">
      <div className="grid w-full items-stretch gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
        {/* Form */}
        <div className="order-2 lg:order-1 flex flex-col justify-center">
          <div className="mx-auto w-full max-w-[420px]">
            {mode === 'forgot' || mode === 'reset' ? (
              <Recover mode={mode} where={where} next={next} signinHref={routes.signin + q} forgotHref={routes.forgot + q} />
            ) : done ? (
              <Done done={done} next={next} batch={batch} signinHref={routes.signin + q} where={where} />
            ) : (
              <>
                <div role="tablist" className="grid grid-cols-2 rounded-full bg-[#0A0A0A]/[0.06] p-1 text-sm font-medium">
                  <Link role="tab" aria-selected={signup} href={routes.signup + q} replace className={`rounded-full py-2 text-center transition-colors ${signup ? 'bg-white text-[#0A0A0A] shadow-sm' : 'text-[#0A0A0A]/55 hover:text-[#0A0A0A]'}`}>Create account</Link>
                  <Link role="tab" aria-selected={!signup} href={routes.signin + q} replace className={`rounded-full py-2 text-center transition-colors ${!signup ? 'bg-white text-[#0A0A0A] shadow-sm' : 'text-[#0A0A0A]/55 hover:text-[#0A0A0A]'}`}>Sign in</Link>
                </div>

                <h1 className="mt-5 lg:mt-6 font-display text-[26px] sm:text-[32px] font-bold leading-[1.08] tracking-tight text-[#0A0A0A]">
                  {signup ? 'Create your free account' : 'Welcome back'}
                </h1>
                <p className="mt-1.5 hidden text-[15px] leading-relaxed text-[#0A0A0A]/60 sm:block">
                  {!GROUP_BUY_ENABLED
                    ? 'Your name and email filled in at checkout.'
                    : signup
                      ? 'Follow your Group Buy orders and keep your rewards.'
                      : 'See your orders, batch timelines and rewards.'}
                </p>

                <form onSubmit={submit} className="mt-5 space-y-2.5">
                  {signup && (
                    <Field id={`${uid}-name`} label="Your name" icon={User}>
                      <input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" required placeholder="Your name" className={inputCls} />
                    </Field>
                  )}
                  <Field id={`${uid}-email`} label="Email" icon={Mail}>
                    <input id={`${uid}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required placeholder="you@email.com" className={inputCls} />
                  </Field>
                  <PasswordField id={`${uid}-password`} label="Password" value={password} onChange={setPassword} fresh={signup} />
                  {!signup && (
                    <div className="flex justify-end">
                      <Link href={routes.forgot + q} className="text-xs font-medium text-[#0A0A0A]/55 underline-offset-2 hover:text-[#0A0A0A] hover:underline">Forgot password?</Link>
                    </div>
                  )}

                  {signup && listOpen && (
                    <label className="!mt-3.5 flex cursor-pointer items-start gap-3 rounded-xl border border-[#22C55E]/40 bg-[#22C55E]/[0.07] px-3.5 py-3">
                      <input type="checkbox" checked={joinList} onChange={(e) => setJoinList(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#16A34A]" />
                      <span className="text-[13px] leading-snug text-[#0A0A0A]">
                        <b className="font-semibold">Join the {batch.label} list</b>
                        {reward ? <> and get <b className="font-semibold">{rewardOff(reward)} {rewardWhere(reward)}</b>. Your code is emailed to you.</> : <> to hear about it by email.</>}
                      </span>
                    </label>
                  )}

                  {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                  {resent && <p className="rounded-lg bg-[#22C55E]/10 px-3 py-2 text-sm text-[#15803D]">{resent}</p>}

                  <button type="submit" disabled={loading} className="group !mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#22C55E] text-[15px] font-semibold text-[#0A0A0A] transition-colors hover:bg-[#1eb455] disabled:opacity-60 cursor-pointer">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {loading ? (signup ? 'Creating your account…' : 'Signing in…') : signup ? 'Create free account' : 'Sign in'}
                    {!loading && <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-[3px]" />}
                  </button>
                </form>

                {!signup && (
                  <p className="mt-4 text-center text-xs text-[#0A0A0A]/45">
                    Didn&apos;t get the confirmation email? <button type="button" onClick={resend} className="underline underline-offset-2 hover:text-[#0A0A0A] cursor-pointer">Send it again</button>
                  </p>
                )}
                {signup && (
                  <p className="mt-4 text-center text-xs leading-relaxed text-[#0A0A0A]/45">
                    By creating an account you agree to our <Link href="/terms" className="underline underline-offset-2">Terms</Link> and <Link href="/privacy" className="underline underline-offset-2">Privacy Policy</Link>.
                  </p>
                )}

                {/* Phones get the perks under the form; the side panel has them on desktop. */}
                <ul className="mt-8 space-y-2.5 border-t border-[#0A0A0A]/10 pt-6 lg:hidden">
                  {PERKS.map((p) => (
                    <li key={p} className="flex gap-2.5 text-sm text-[#0A0A0A]/70"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#16A34A]" />{p}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        {/* Side panel: the open batch and what an account gets you */}
        <aside className="order-1 lg:order-2 overflow-hidden rounded-2xl bg-[#0A0A0A] text-white">
          <div className="flex h-full flex-col p-5 sm:p-8 lg:p-9">
            {batch && listOpen ? <BatchPitch batch={batch} /> : (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/50">Ascend MY account</p>
                <h2 className="mt-3 font-display text-2xl sm:text-3xl font-bold leading-tight tracking-tight">Everything you order, in one place.</h2>
              </>
            )}
            <ul className="mt-7 hidden space-y-3 border-t border-white/10 pt-7 lg:block">
              {PERKS.map((p) => (
                <li key={p} className="flex gap-3 text-[15px] leading-snug text-white/80">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#22C55E] text-[#0A0A0A]"><Check className="h-3 w-3" strokeWidth={3} /></span>
                  {p}
                </li>
              ))}
            </ul>
            <p className="mt-auto hidden pt-6 text-xs text-white/40 lg:block">Free to create · Buying as a guest still works</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function BatchPitch({ batch }: { batch: AuthBatch }) {
  const upcoming = batch.phase === 'UPCOMING';
  const now = useNow();
  const left = now === null ? null : countdown(upcoming ? batch.opensAt : batch.closesAt, now);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/55"><span className="hidden sm:inline">Group Buy · </span>{batch.label}</span>
        {upcoming
          ? <span className="rounded-full bg-[#3155D9] px-2.5 py-0.5 text-xs font-medium">Opening soon</span>
          : <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium"><span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />Live now</span>}
        {/* Phones: the countdown as one line, so the form stays above the fold. */}
        <span className="ml-auto text-xs tabular-nums text-white/55 lg:hidden" suppressHydrationWarning>
          {left && !left.done ? `${upcoming ? 'Opens' : 'Ends'} in ${left.d}d ${left.h}h` : ''}
        </span>
      </div>
      {batch.reward ? (
        <>
          <p className="mt-3 lg:mt-4 font-display font-bold tracking-tight">
            <span className="text-3xl lg:block lg:text-5xl lg:leading-none text-[#22C55E]">{rewardOff(batch.reward)}</span>{' '}
            <span className="text-lg lg:mt-1 lg:block lg:text-2xl font-semibold leading-tight">on {rewardWhere(batch.reward)}</span>
          </p>
          <p className="mt-3 hidden max-w-sm text-sm leading-relaxed text-white/60 lg:block">For joining the {batch.label} list when you create your account. The code is emailed to you.</p>
        </>
      ) : (
        <h2 className="mt-4 font-display text-2xl sm:text-3xl font-bold leading-tight tracking-tight">{batch.title}</h2>
      )}
      <div className="mt-5 hidden items-center gap-3 lg:flex">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/45">{upcoming ? 'Opens in' : 'Closes in'}</span>
        <div className="flex gap-1.5" suppressHydrationWarning>
          {(['d', 'h', 'm', 's'] as const).map((k) => (
            <span key={k} className="min-w-[44px] rounded-md bg-white/[0.08] px-1.5 py-1 text-center font-display text-base font-semibold tabular-nums" suppressHydrationWarning>
              {left ? String(left[k]).padStart(2, '0') : '–'}<span className="ml-0.5 text-[10px] font-normal text-white/45">{k}</span>
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

function Done({ done, next, batch, signinHref, where }: { done: { name: string; email: string; joined: boolean; inbox: boolean }; next: string; batch: AuthBatch | null; signinHref: string; where: Where }) {
  const settings = useStoreSettings();
  // The store's sign-up bonus, while it is on (Group Buy has its own rewards).
  const bonusPct = where === 'store' && settings?.signup_bonus_enabled === 'true' ? Number(settings.signup_bonus_pct || 10) : null;
  if (done.inbox) {
    // Register can't say whether the address was taken (see the API), so this
    // is worded to be true either way.
    return (
      <div className="text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#22C55E]/15 text-[#15803D]"><MailCheck className="h-7 w-7" /></span>
        <h1 className="mt-5 font-display text-3xl font-bold tracking-tight text-[#0A0A0A]">Check your inbox</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#0A0A0A]/60">If {done.email} is new to us, a confirmation link is on its way. Already have an account with it? Sign in instead.</p>
        <Link href={signinHref} className="mt-7 inline-flex h-12 items-center gap-2 rounded-full bg-[#0A0A0A] px-6 text-[15px] font-semibold text-white hover:bg-[#262626]">Sign in <ArrowRight className="h-4 w-4" /></Link>
      </div>
    );
  }
  const toBatch = batch && next.startsWith(`/group-buy/${batch.slug}`);
  return (
    <div>
      <span className="grid h-14 w-14 place-items-center rounded-full bg-[#22C55E] text-[#0A0A0A]"><Check className="h-7 w-7" strokeWidth={3} /></span>
      <h1 className="mt-6 font-display text-[34px] font-bold leading-[1.08] tracking-tight text-[#0A0A0A]">You&apos;re in{done.name ? `, ${done.name.split(' ')[0]}` : ''}.</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-[#0A0A0A]/60">Your account is ready and you&apos;re signed in.</p>
      <ul className="mt-6 space-y-3 rounded-2xl border border-[#0A0A0A]/10 bg-white p-5 text-sm leading-snug text-[#0A0A0A]/75">
        {done.joined && batch && (
          <li className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#16A34A]" /><span>You&apos;re on the <b className="font-semibold text-[#0A0A0A]">{batch.label}</b> list{batch.reward ? <> — your {rewardOff(batch.reward)} code is on its way to {done.email}</> : null}.</span></li>
        )}
        <li className="flex gap-2.5"><Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#0A0A0A]/50" /><span><b className="font-semibold text-[#0A0A0A]">Confirm your email</b> with the link we sent to {done.email}. Orders you placed as a guest with it show up once it&apos;s confirmed.</span></li>
        {bonusPct && (
          <li className="flex gap-2.5"><Gift className="mt-0.5 h-4 w-4 shrink-0 text-[#16A34A]" /><span>Confirming it unlocks your <b className="font-semibold text-[#0A0A0A]">{bonusPct}% first-order code</b> (one per person). We email it to you and show it on your account.</span></li>
        )}
      </ul>
      <Link href={next} className="group mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#22C55E] text-[15px] font-semibold text-[#0A0A0A] hover:bg-[#1eb455]">
        {toBatch ? `Continue to ${batch.label}` : next.startsWith('/group-buy') ? 'Continue to Group Buy' : 'Continue'}
        <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-[3px]" />
      </Link>
    </div>
  );
}

/** Forgot password (asks for the email) and reset password (the emailed link lands here). */
function Recover({ mode, where, next, signinHref, forgotHref }: { mode: 'forgot' | 'reset'; where: Where; next: string; signinHref: string; forgotHref: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const uid = useId();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(mode === 'reset' && !token ? 'This link is missing its reset token. Ask for a new one below.' : '');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [saved, setSaved] = useState(false);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      await memberForgotPassword(email, where);
      setSent(true);
    } catch (err) {
      setError(apiError(err, 'Could not send that right now. Please try again shortly.'));
    } finally {
      setLoading(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < MIN_PASSWORD) { setError(`Use at least ${MIN_PASSWORD} characters for your password.`); return; }
    setLoading(true);
    try {
      const res = await memberResetPassword(token, password);
      setMemberSession(res.token, res.member);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(apiError(err, 'This reset link is invalid or has expired.'));
    } finally {
      setLoading(false);
    }
  };

  const back = (
    <Link href={signinHref} replace className="inline-flex items-center gap-1.5 text-sm font-medium text-[#0A0A0A]/55 hover:text-[#0A0A0A]">
      <ArrowLeft className="h-4 w-4" />Back to sign in
    </Link>
  );

  if (sent) {
    return (
      <div>
        {back}
        <span className="mt-8 grid h-14 w-14 place-items-center rounded-full bg-[#22C55E]/15 text-[#15803D]"><MailCheck className="h-7 w-7" /></span>
        <h1 className="mt-5 font-display text-[32px] font-bold leading-[1.08] tracking-tight text-[#0A0A0A]">Check your inbox</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#0A0A0A]/60">If <b className="font-semibold text-[#0A0A0A]">{email}</b> has an account, a link to choose a new password is on its way. It works once and expires in 1 hour.</p>
        <p className="mt-6 text-sm text-[#0A0A0A]/55">Nothing yet? Check spam, or <button type="button" onClick={() => send()} disabled={loading} className="font-medium text-[#0A0A0A] underline underline-offset-2 cursor-pointer disabled:opacity-50">send it again</button>.</p>
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  if (saved) {
    return (
      <div>
        <span className="grid h-14 w-14 place-items-center rounded-full bg-[#22C55E] text-[#0A0A0A]"><Check className="h-7 w-7" strokeWidth={3} /></span>
        <h1 className="mt-6 font-display text-[34px] font-bold leading-[1.08] tracking-tight text-[#0A0A0A]">Password updated.</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#0A0A0A]/60">You&apos;re signed in with your new password. Any other device signed in to this account has been signed out.</p>
        <Link href={next} className="group mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#22C55E] text-[15px] font-semibold text-[#0A0A0A] hover:bg-[#1eb455]">
          {next.startsWith('/group-buy') ? 'Continue to Group Buy' : 'Continue'}
          <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-[3px]" />
        </Link>
      </div>
    );
  }

  const forgot = mode === 'forgot';
  return (
    <div>
      {back}
      <span className="mt-8 grid h-12 w-12 place-items-center rounded-2xl bg-[#0A0A0A] text-white"><KeyRound className="h-5 w-5" /></span>
      <h1 className="mt-5 font-display text-[26px] sm:text-[32px] font-bold leading-[1.08] tracking-tight text-[#0A0A0A]">
        {forgot ? 'Forgot your password?' : 'Choose a new password'}
      </h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-[#0A0A0A]/60">
        {forgot ? 'Type the email you signed up with and we’ll send you a link to choose a new one.' : 'Pick something you don’t use anywhere else. You’ll be signed in straight after.'}
      </p>

      <form onSubmit={forgot ? send : save} className="mt-6 space-y-2.5">
        {forgot ? (
          <Field id={`${uid}-email`} label="Email" icon={Mail}>
            <input id={`${uid}-email`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus placeholder="you@email.com" className={inputCls} />
          </Field>
        ) : (
          <PasswordField id={`${uid}-password`} label="New password" value={password} onChange={setPassword} fresh placeholder={`New password (${MIN_PASSWORD}+ characters)`} />
        )}

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}{!forgot && <> <Link href={forgotHref} className="font-medium underline underline-offset-2">Get a new link</Link></>}
          </p>
        )}

        <button type="submit" disabled={loading || (!forgot && !token)} className="group !mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#22C55E] text-[15px] font-semibold text-[#0A0A0A] transition-colors hover:bg-[#1eb455] disabled:opacity-60 cursor-pointer">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? (forgot ? 'Sending…' : 'Saving…') : forgot ? 'Send reset link' : 'Save new password'}
          {!loading && <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-[3px]" />}
        </button>
      </form>
    </div>
  );
}
