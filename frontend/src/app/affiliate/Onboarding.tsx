'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, Clock, Copy, Landmark, Link2, Mail, RefreshCw, Shuffle } from 'lucide-react';
import { memberMe, memberResendVerification } from '@/lib/api';
import { getMemberToken, updateMemberCache } from '@/lib/member-session';
import {
  apiError,
  checkAffiliateCode,
  joinAffiliate,
  suggestAffiliateCode,
  updateMyAffiliate,
  type MyAffiliate,
  type Programme,
} from '@/lib/affiliate-api';
import { FitBox } from './AuthShowcase';
import { Field, Notice, useAffHref } from './aff-ui';
import { BANKS } from './banks';

/**
 * Onboarding (Fakhrul, 2026-11-03): the moment someone signs in without being
 * an affiliate, they are walked through joining one step at a time — confirm
 * the email, who they are, their code, where we pay them, then agree and send.
 * The dark panel beside it shows what each step makes, live, as they type.
 * Bank details go in with the application, so the team approves them with it.
 * Then a waiting screen until they're approved (the tour takes over from there,
 * Tour.tsx).
 */

export const TERMS = [
  'Commission is earned on the goods (after the discount, not shipping) once an order is paid.',
  'If an order is refunded or cancelled, its commission is taken back — even after it was paid out.',
  'You can ask for a payout any time you have a balance; it is paid after a short hold so refunds land first.',
  'Your own orders never earn commission.',
  'Share honestly: no medical claims, no spam, no posting the code on coupon sites. We may pause a code that breaks this.',
];

type StepId = 'email' | 'you' | 'code' | 'payouts' | 'review';
const STEP_LABEL: Record<StepId, string> = { email: 'Your email', you: 'About you', code: 'Your code', payouts: 'Payouts', review: 'Review' };

const normalise = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
const initialsOf = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';

interface Member {
  displayName: string;
  email: string;
  emailVerified: boolean;
}

export function JoinWizard({ member, programme, onJoined }: { member: Member; programme: Programme; onJoined: () => Promise<void> }) {
  const steps: StepId[] = [...(member.emailVerified ? [] : (['email'] as StepId[])), 'you', 'code', 'payouts', 'review'];
  const [at, setAt] = useState(0);
  const step = steps[Math.min(at, steps.length - 1)];

  // What they're building.
  const [fullName, setFullName] = useState(member.displayName);
  const [phone, setPhone] = useState('');
  const [channel, setChannel] = useState('');
  const [code, setCode] = useState('');
  const [codeState, setCodeState] = useState<{ code: string; ok: boolean; reason: string | null } | null>(null);
  const [bank, setBank] = useState('');
  const [otherBank, setOtherBank] = useState('');
  const [holder, setHolder] = useState('');
  const [accNo, setAccNo] = useState('');
  const [skipBank, setSkipBank] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // One suggestion from their initials, until they type their own.
  const suggested = useRef(false);
  useEffect(() => {
    if (suggested.current) return;
    suggested.current = true;
    suggestAffiliateCode(member.displayName).then((r) => setCode((c) => c || r.code), () => {});
  }, [member.displayName]);
  const shuffle = () => suggestAffiliateCode(fullName || member.displayName).then((r) => setCode(r.code), () => {});

  const c = normalise(code);
  useEffect(() => {
    if (c.length < 4) return;
    const t = setTimeout(() => checkAffiliateCode(c).then((r) => setCodeState({ code: r.code, ok: r.available, reason: r.reason }), () => {}), 300);
    return () => clearTimeout(t);
  }, [c]);

  const bankName = bank === 'Other' ? otherBank.trim() : bank;
  const digits = accNo.replace(/[\s-]/g, '');
  const holderValue = holder || fullName.toUpperCase();

  // What stops each step.
  const problem: Record<StepId, string | null> = {
    email: member.emailVerified ? null : 'Confirm your email to carry on.',
    you: fullName.trim().length < 2 ? 'Enter your full name.' : phone.replace(/\D/g, '').length < 9 ? 'Enter your WhatsApp number.' : null,
    code:
      c.length < 4
        ? 'At least 4 letters or numbers.'
        : codeState?.code === c && !codeState.ok
          ? codeState.reason ?? 'That code is taken.'
          : codeState?.code !== c
            ? 'Checking…'
            : null,
    payouts: skipBank ? null : !bankName ? 'Choose your bank.' : holderValue.trim().length < 2 ? 'Enter the account holder name.' : !/^\d{6,24}$/.test(digits) ? 'Account number: numbers only, as on your statement.' : null,
    review: agree ? null : 'Tick to agree.',
  };

  const next = () => {
    setError('');
    setAt((i) => Math.min(i + 1, steps.length - 1));
  };
  const back = () => {
    setError('');
    setAt((i) => Math.max(i - 1, 0));
  };
  const goTo = (id: StepId) => setAt(steps.indexOf(id));

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      await joinAffiliate({
        fullName: fullName.trim(),
        phone: phone.trim(),
        channel: channel.trim() || undefined,
        code: c,
        ...(skipBank ? {} : { bankName, bankAccountName: holderValue.trim(), bankAccountNumber: digits }),
        acceptTerms: true,
      });
      await onJoined();
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  const d = programme.customerDiscountPct;
  const rate = programme.commission;

  return (
    <div className="aff-auth grid items-stretch gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(400px,500px)]">
      <Preview
        step={step}
        name={fullName}
        phone={phone}
        channel={channel}
        code={c || 'YOURCODE'}
        bank={skipBank ? '' : bankName}
        holder={holderValue}
        last4={digits.slice(-4)}
        d={d}
        rate={rate}
        hold={programme.holdDays}
      />

      {/* On a phone the form leads and the preview follows it; side by side on a computer. */}
      <section className="aff-auth-card panel order-first flex min-h-0 flex-col overflow-y-auto p-6 sm:p-10 lg:order-none" aria-labelledby="ob-h">
        {/* Where they are. */}
        <div className="flex items-center gap-3">
          <div className="flex flex-1 gap-1.5" aria-hidden>
            {steps.map((s, i) => (
              <span key={s} className="h-1 flex-1 rounded-full transition-colors duration-[200ms]" style={{ background: i <= at ? 'var(--st-solid)' : 'var(--st-hair)' }} />
            ))}
          </div>
          <span className="text-[12px] fg-3 tnum">
            {at + 1} of {steps.length}
          </span>
        </div>
        <p className="mt-6 text-[13px] font-medium fg-3">{STEP_LABEL[step]}</p>

        <div className="mt-1 flex-1">
          {step === 'email' ? <EmailStep email={member.email} /> : null}

          {step === 'you' ? (
            <>
              <h1 id="ob-h" className="aff-auth-h st-title fg !text-[30px] !leading-[36px]">Tell us about you</h1>
              <p className="mt-2 text-[15px] leading-[22px] fg-2">So we know who you are and how to reach you.</p>
              <div className="aff-auth-form mt-6 grid gap-4">
                <Field label="Full name" help="As on your bank account — your payouts go to it.">
                  <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
                </Field>
                <Field label="WhatsApp number" help="We message you here about payouts.">
                  <input className="input" type="tel" inputMode="tel" placeholder="012 345 6789" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
                </Field>
                <Field label="Where will you share it? (optional)" help="Helps us approve you.">
                  <input className="input" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="e.g. @yourname on Instagram, a WhatsApp group, your gym" />
                </Field>
              </div>
            </>
          ) : null}

          {step === 'code' ? (
            <>
              <h1 id="ob-h" className="aff-auth-h st-title fg !text-[30px] !leading-[36px]">Pick your code</h1>
              <p className="mt-2 text-[15px] leading-[22px] fg-2">
                What your people type at checkout for {d}% off. We made one from your initials — keep it, shuffle, or write your own.
              </p>
              <div className="aff-auth-form mt-6 grid gap-4">
                <Field
                  label="Your code"
                  error={c.length >= 4 && codeState?.code === c && !codeState.ok ? codeState.reason : null}
                  help={codeState?.code === c && codeState.ok ? 'Available — it’s yours once you send this.' : '4 to 16 letters and numbers.'}
                >
                  <div className="flex gap-2">
                    <input className="input uppercase tracking-[0.08em]" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} />
                    <button type="button" className="btn btn-soft shrink-0" onClick={shuffle} aria-label="Suggest another code">
                      <Shuffle className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Shuffle</span>
                    </button>
                  </div>
                </Field>
                <p className="text-[13px] leading-[19px] fg-3">Once you&apos;re approved the code is live and doesn&apos;t change — every link you share uses it.</p>
              </div>
            </>
          ) : null}

          {step === 'payouts' ? (
            <>
              <h1 id="ob-h" className="aff-auth-h st-title fg !text-[30px] !leading-[36px]">Where we pay you</h1>
              <p className="mt-2 text-[15px] leading-[22px] fg-2">Your commission goes to this account. We check it along with your application.</p>
              {skipBank ? (
                <div className="mt-6">
                  <Notice>You can add it later in Settings — you&apos;ll need it before asking for a payout.</Notice>
                  <button type="button" className="btn btn-soft btn-sm mt-3" onClick={() => setSkipBank(false)}>Add it now instead</button>
                </div>
              ) : (
                <div className="aff-auth-form mt-6 grid gap-4">
                  <Field label="Bank">
                    <select className="input" value={bank} onChange={(e) => setBank(e.target.value)}>
                      <option value="">Choose your bank</option>
                      {BANKS.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                      <option value="Other">Other</option>
                    </select>
                  </Field>
                  {bank === 'Other' ? (
                    <Field label="Bank name">
                      <input className="input" value={otherBank} onChange={(e) => setOtherBank(e.target.value)} />
                    </Field>
                  ) : null}
                  <Field label="Account holder name" help="Must match the account.">
                    <input className="input" value={holderValue} onChange={(e) => setHolder(e.target.value)} />
                  </Field>
                  <Field label="Account number">
                    <input className="input tnum" inputMode="numeric" value={accNo} onChange={(e) => setAccNo(e.target.value)} />
                  </Field>
                  <button type="button" className="justify-self-start text-[13px] fg-3 underline underline-offset-4" onClick={() => setSkipBank(true)}>
                    Skip for now
                  </button>
                </div>
              )}
            </>
          ) : null}

          {step === 'review' ? (
            <>
              <h1 id="ob-h" className="aff-auth-h st-title fg !text-[30px] !leading-[36px]">Check and send</h1>
              <dl className="mt-5 grid gap-2.5 text-[14px]">
                {(
                  [
                    ['You', `${fullName.trim()} · ${phone.trim()}`, 'you'],
                    ['Code', c, 'code'],
                    ['Payouts', skipBank || !bankName ? 'Add later in Settings' : `${bankName} ····${digits.slice(-4)} (${holderValue.trim()})`, 'payouts'],
                  ] as [string, string, StepId][]
                ).map(([k, v, id]) => (
                  <div key={k} className="flex items-center gap-3 rounded-[16px] px-4 py-3" style={{ background: 'var(--st-field)' }}>
                    <dt className="w-[72px] shrink-0 fg-3">{k}</dt>
                    <dd className="min-w-0 flex-1 truncate font-medium fg">{v}</dd>
                    <button type="button" className="shrink-0 text-[13px] fg-2 underline underline-offset-4" onClick={() => goTo(id)}>Edit</button>
                  </div>
                ))}
              </dl>
              <details className="mt-4 rounded-[16px] px-4 py-3" style={{ background: 'var(--st-field)' }}>
                <summary className="cursor-pointer text-[14px] font-medium fg">How Ascend Affiliate works</summary>
                <ul className="mt-3 grid gap-2">
                  {TERMS.map((t) => (
                    <li key={t} className="flex gap-2.5 text-[13px] leading-[19px] fg-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--st-ok)' }} aria-hidden />
                      {t}
                    </li>
                  ))}
                </ul>
              </details>
              <label className="mt-4 flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--st-solid)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                <span className="text-[14px] leading-[20px] fg-2">I&apos;ve read how it works and I agree.</span>
              </label>
            </>
          ) : null}
        </div>

        {error ? (
          <div className="mt-4">
            <Notice tone="bad">{error}</Notice>
          </div>
        ) : null}

        <div className="mt-6 flex items-center gap-2">
          {at > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={back} disabled={busy}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back
            </button>
          ) : null}
          {/* What's missing, said plainly next to the disabled button. */}
          <p className="flex-1 text-right text-[12px] leading-4 fg-3" aria-live="polite">
            {step !== 'email' && problem[step] && problem[step] !== 'Checking…' ? problem[step] : ''}
          </p>
          {step === 'review' ? (
            <button type="button" className="btn btn-ink h-12 px-7" disabled={busy || !!problem.review || !!problem.you || !!problem.code} onClick={submit}>
              {busy ? 'Sending…' : 'Send my application'}
            </button>
          ) : step === 'email' ? null : (
            <button type="button" className="btn btn-ink h-12 px-7" disabled={!!problem[step]} onClick={next}>
              Continue <ArrowRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/** Step zero for an unconfirmed address: resend, and look again once they've clicked the link. */
function EmailStep({ email }: { email: string }) {
  const [sent, setSent] = useState<'idle' | 'sent' | 'failed'>('idle');
  const [checking, setChecking] = useState(false);
  const [still, setStill] = useState(false);
  const check = async () => {
    const token = getMemberToken();
    if (!token) return;
    setChecking(true);
    setStill(false);
    try {
      const fresh = await memberMe(token);
      updateMemberCache(fresh);
      // Confirmed: the wizard re-renders without this step. Not yet: say so.
      if (!fresh.emailVerified) setStill(true);
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <h1 id="ob-h" className="aff-auth-h st-title fg !text-[30px] !leading-[36px]">Confirm your email</h1>
      <p className="mt-2 text-[15px] leading-[22px] fg-2">
        We sent a link to <strong className="fg">{email}</strong>. Payouts go to real people, so we check the address is yours first.
      </p>
      <div className="mt-6 grid gap-3">
        <button type="button" className="btn btn-ink h-12" onClick={check} disabled={checking}>
          <RefreshCw className="h-4 w-4" aria-hidden /> {checking ? 'Checking…' : 'I’ve confirmed it'}
        </button>
        <button
          type="button"
          className="btn btn-soft"
          disabled={sent === 'sent'}
          onClick={() => memberResendVerification(email).then(() => setSent('sent'), () => setSent('failed'))}
        >
          <Mail className="h-4 w-4" aria-hidden /> {sent === 'sent' ? 'Sent again — check your inbox' : sent === 'failed' ? 'Couldn’t send. Try again' : 'Send the link again'}
        </button>
        {still ? <Notice tone="warn">Not confirmed yet. Open the link in the email, then press the button again.</Notice> : null}
      </div>
    </>
  );
}

/* ── The live preview beside the steps ── */

function Preview(p: {
  step: StepId;
  name: string;
  phone: string;
  channel: string;
  code: string;
  bank: string;
  holder: string;
  last4: string;
  d: number;
  rate: string;
  hold: number;
}) {
  const slides: Record<StepId, { title: string; sub: string; visual: React.ReactNode }> = {
    email: {
      title: 'First, your email.',
      sub: 'One tap on the link we sent, and you’re in.',
      visual: (
        <div className="w-full max-w-[440px] rounded-[22px] bg-white p-6 text-[#0a0a0a]">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0a0a0a] text-white"><Mail className="h-4 w-4" aria-hidden /></span>
            <div>
              <p className="text-[14px] font-semibold">Ascend MY</p>
              <p className="text-[12px] text-[#525252]">Confirm your email</p>
            </div>
          </div>
          <div className="mt-5 h-2 w-4/5 rounded-full bg-[#f1f1f1]" />
          <div className="mt-2 h-2 w-3/5 rounded-full bg-[#f1f1f1]" />
          <div className="mt-5 inline-flex rounded-full bg-[#0a0a0a] px-5 py-2.5 text-[13px] font-semibold text-white">Confirm my email</div>
        </div>
      ),
    },
    you: {
      title: 'This is you.',
      sub: 'Your name goes on your payouts; your WhatsApp is how we reach you.',
      visual: (
        <div className="w-full max-w-[440px] rounded-[24px] bg-white p-6 text-[#0a0a0a] shadow-[0_30px_60px_-30px_rgb(0_0_0/0.8)]">
          <div className="flex items-center gap-4">
            <span className="st-display flex h-14 w-14 items-center justify-center rounded-[16px] bg-[#0a0a0a] text-[20px] font-semibold text-white">{initialsOf(p.name)}</span>
            <div className="min-w-0">
              <p className="st-display truncate text-[20px] font-semibold">{p.name.trim() || 'Your name'}</p>
              <p className="text-[13px] text-[#525252]">Ascend affiliate</p>
            </div>
          </div>
          <div className="mt-5 grid gap-2 text-[13px]">
            <p className="flex justify-between rounded-[12px] bg-[#f5f5f5] px-3 py-2.5"><span className="text-[#525252]">WhatsApp</span><span className="font-medium tabular-nums">{p.phone.trim() || '—'}</span></p>
            <p className="flex justify-between gap-4 rounded-[12px] bg-[#f5f5f5] px-3 py-2.5"><span className="shrink-0 text-[#525252]">Shares on</span><span className="truncate font-medium">{p.channel.trim() || '—'}</span></p>
          </div>
        </div>
      ),
    },
    code: {
      title: 'Your code. Your link.',
      sub: `Your people get ${p.d}% off; you earn ${p.rate} of what they pay.`,
      visual: (
        <div className="grid w-full grid-cols-[minmax(0,1fr)] items-end gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <div className="rounded-[22px] bg-white/[0.04] p-5 ring-1 ring-white/10">
            <p className="text-[12px] text-white/55">Your code</p>
            <p className="st-display mt-1 truncate text-[40px] font-semibold leading-none tracking-[0.06em]">{p.code}</p>
            <div className="mt-4 flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[#0a0a0a]">
              <Link2 className="h-4 w-4 shrink-0 text-[#525252]" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">ascendpeptides.my/?ref={p.code}</span>
              <Copy className="h-4 w-4 shrink-0 text-[#525252]" aria-hidden />
            </div>
          </div>
          <div className="mx-auto w-[200px] rounded-[30px] bg-[#1a1a1a] p-2 ring-1 ring-white/15 sm:mx-0">
            <div className="rounded-[24px] bg-white p-3 text-[#0a0a0a]">
              <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-[#e5e5e5]" />
              <p className="text-[11px] text-[#525252]">Checkout</p>
              <div className="mt-2 rounded-[12px] bg-[#22c55e]/10 p-2.5 text-[11px] font-semibold leading-[15px] text-[#15803d]">
                {p.code} · {p.d}% off applied
              </div>
              <div className="mt-3 rounded-full bg-[#0a0a0a] py-2 text-center text-[11px] font-semibold text-white">Place order</div>
            </div>
          </div>
        </div>
      ),
    },
    payouts: {
      title: 'Where we pay you.',
      sub: p.hold ? `Ask whenever you have a balance — paid after a ${p.hold}-day hold. No minimum.` : 'Ask whenever you have a balance. No minimum.',
      visual: (
        <div className="w-full max-w-[460px] rounded-[22px] bg-white/[0.04] p-5 ring-1 ring-white/10">
          <div className="flex items-center gap-3 rounded-[16px] bg-white p-4 text-[#0a0a0a]">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[#0a0a0a] text-white"><Landmark className="h-5 w-5" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold">{p.bank || 'Your bank'}</p>
              <p className="truncate text-[12px] text-[#525252]">{p.holder.trim() || 'Account holder'}</p>
            </div>
            <p className="text-[15px] font-semibold tabular-nums">····{p.last4 || '0000'}</p>
          </div>
          <ol className="mt-4 flex items-center gap-2 text-[12px]">
            {['You ask', ...(p.hold ? [`${p.hold}-day hold`] : []), 'Paid'].map((t, i, all) => (
              <li key={t} className="flex flex-1 items-center gap-2">
                <span className={`flex-1 rounded-[12px] px-3 py-2 text-center font-semibold ${i === all.length - 1 ? 'bg-[#22c55e] text-[#052e16]' : 'bg-white/10'}`}>{t}</span>
                {i < all.length - 1 ? <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/40" aria-hidden /> : null}
              </li>
            ))}
          </ol>
        </div>
      ),
    },
    review: {
      title: 'Almost there.',
      sub: 'Send it, and we take it from here.',
      visual: <NextSteps current={0} />,
    },
  };
  const order: StepId[] = ['email', 'you', 'code', 'payouts', 'review'];
  return (
    <section className="aff-show relative isolate flex flex-col overflow-hidden rounded-[28px] p-6 text-white sm:p-10 lg:h-full" aria-hidden>
      {/* One grid cell for every step (see AuthShowcase): full size on a phone, fitted on a computer. */}
      <div className="aff-show-stage relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        {order.map((id) => (
          <div key={id} className={`aff-show-slide col-start-1 row-start-1 flex min-h-0 flex-col ${id === p.step ? 'is-on' : ''}`} {...(id !== p.step ? { inert: true } : {})}>
            <h2 className="aff-show-in aff-show-title st-display max-w-[540px] font-semibold tracking-[-0.02em]">{slides[id].title}</h2>
            <p className="aff-show-in aff-show-d1 aff-show-sub mt-4 max-w-[460px] text-white/65">{slides[id].sub}</p>
            <div className="aff-show-in aff-show-d2 aff-show-visual mt-8 min-h-0 flex-1">
              <FitBox>{slides[id].visual}</FitBox>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Sent → reviewed → live → sharing, with where they are now. */
function NextSteps({ current }: { current: number }) {
  const steps = [
    { t: 'Application sent', s: 'Your details, code and bank' },
    { t: 'We review it', s: 'And check your bank details' },
    { t: 'Your code goes live', s: 'Your dashboard opens here' },
    { t: 'Share and earn', s: 'Ask for a payout any time' },
  ];
  return (
    <ol className="grid w-full max-w-[460px] gap-2">
      {steps.map((s, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={s.t} className={`flex items-center gap-3 rounded-[16px] px-4 py-3 ring-1 ${now ? 'bg-white/[0.08] ring-white/25' : 'bg-white/[0.03] ring-white/10'}`}>
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? 'bg-[#22c55e] text-[#052e16]' : now ? 'bg-white text-[#0a0a0a]' : 'bg-white/10 text-white/50'}`}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : now ? <Clock className="h-3.5 w-3.5" aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </span>
            <div className="min-w-0">
              <p className={`text-[15px] font-medium ${done || now ? 'text-white' : 'text-white/60'}`}>{s.t}</p>
              <p className="text-[12px] text-white/45">{s.s}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Applied, waiting for the team ── */

export function WaitingScreen({ data, onChanged }: { data: MyAffiliate; onChanged: () => Promise<void> }) {
  const a = data.affiliate!;
  const href = useAffHref();
  const [code, setCode] = useState(a.code);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const changed = normalise(code) !== a.code;

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
    <div className="aff-auth grid items-stretch gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(400px,500px)]">
      <section className="aff-show relative isolate flex flex-col overflow-hidden rounded-[28px] p-6 text-white sm:p-10 lg:h-full">
        <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium text-white/80">
          <Clock className="h-3.5 w-3.5" aria-hidden /> Waiting for approval
        </span>
        <h1 className="aff-show-title st-display mt-6 max-w-[540px] font-semibold tracking-[-0.02em]">You&apos;re in the queue, {a.fullName.split(' ')[0]}.</h1>
        <p className="aff-show-sub mt-4 max-w-[460px] text-white/65">
          We&apos;ll look at your application and check your details. The moment you&apos;re approved, your code goes live and your dashboard opens here.
        </p>
        <div className="aff-show-visual mt-8 min-h-0 flex-1">
          <FitBox>
            <NextSteps current={1} />
          </FitBox>
        </div>
      </section>

      <section className="aff-auth-card panel flex min-h-0 flex-col justify-center overflow-y-auto p-6 sm:p-10">
        <h2 className="st-h fg">While you wait</h2>
        <p className="mt-1 text-[14px] leading-[21px] fg-2">Your code is held for you. You can still change it until you&apos;re approved.</p>
        <div className="mt-5 flex gap-2">
          <input className="input uppercase tracking-[0.08em]" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Your code" />
          <button type="button" className="btn btn-ink shrink-0" disabled={!changed || busy} onClick={save}>
            {busy ? 'Saving…' : 'Change'}
          </button>
        </div>
        {msg ? (
          <div className="mt-3">
            <Notice tone={msg.tone}>{msg.text}</Notice>
          </div>
        ) : null}

        <dl className="mt-6 grid gap-2 text-[14px]">
          <div className="flex justify-between gap-4 rounded-[16px] px-4 py-3" style={{ background: 'var(--st-field)' }}>
            <dt className="fg-3">WhatsApp</dt>
            <dd className="font-medium fg tnum">{a.phone}</dd>
          </div>
          <div className="flex justify-between gap-4 rounded-[16px] px-4 py-3" style={{ background: 'var(--st-field)' }}>
            <dt className="fg-3">Payouts</dt>
            <dd className="truncate font-medium fg">{a.bankName ? `${a.bankName} ····${a.bankAccountNumber?.slice(-4)}` : 'Add in Settings once approved'}</dd>
          </div>
        </dl>

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <Link href={href('/guide')} className="btn btn-soft">Read the guide</Link>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={checking}
            onClick={async () => {
              setChecking(true);
              await onChanged();
              setChecking(false);
            }}
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> {checking ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </section>
    </div>
  );
}
