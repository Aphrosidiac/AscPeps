'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Gift, Mail } from 'lucide-react';
import type { GroupBuyPhase, GroupBuyReward, GroupBuyStage } from '@/types';
import { countdown, rewardHeadline, rewardOff } from '@/lib/group-buy';
import { signupGroupBuy, type SignupResult } from '@/lib/group-buy-api';
import { useMemberSession } from '@/lib/member-session';

/** Pieces of the Group Buy portal (styles in app/group-buy/portal.css). */

export function PageHead({ eyebrow, title, children, actions, back }: {
  eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode; back?: { href: string; label: string };
}) {
  return (
    <header className="gbp-ph">
      <div className="left">
        {back && <Link href={back.href} className="gbp-back"><ArrowLeft size={14} />{back.label}</Link>}
        {eyebrow && <div className="label gbp-eyebrow">{eyebrow}</div>}
        <h1 className="display">{title}</h1>
        {children && <div className="sub">{children}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function PhaseChip({ phase, stageLabel }: { phase: GroupBuyPhase; stageLabel?: string | null }) {
  if (phase === 'LIVE') return <span className="gbp-chip live"><span className="d" />Live now</span>;
  if (phase === 'UPCOMING') return <span className="gbp-chip info"><span className="d" />Opening soon</span>;
  if (phase === 'CLOSED') return <span className="gbp-chip line">{stageLabel ? `Closed · ${stageLabel}` : 'Closed'}</span>;
  return <span className="gbp-chip warn">Draft — only you can see this</span>;
}

/** Ticks once a second; renders dashes on the server pass to avoid a mismatch. */
export function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const c = countdown(to, now ?? 0);
  const cells: [number, string][] = [[c.d, 'days'], [c.h, 'hrs'], [c.m, 'min'], [c.s, 'sec']];
  return (
    <div className="gbp-count" aria-live="off" suppressHydrationWarning>
      {cells.map(([v, l]) => (
        <span key={l}><b suppressHydrationWarning>{now === null ? '–' : String(v).padStart(2, '0')}</b><i>{l}</i></span>
      ))}
    </div>
  );
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The batch timeline: steps before the current one done (ink), the current one
 * green, the rest waiting. Notes from the team sit under their step.
 */
export function Timeline({ stages, stageKey, compact = false }: { stages: GroupBuyStage[]; stageKey: string; compact?: boolean }) {
  const at = Math.max(stages.findIndex((s) => s.key === stageKey), 0);
  return (
    <ol className="gbp-tl">
      {stages.map((s, i) => {
        const state = i < at ? 'done' : i === at ? 'now' : 'todo';
        return (
          <li key={s.key} className={state}>
            <span className="dot">{state !== 'todo' && <Check size={13} strokeWidth={3} />}</span>
            <div style={{ minWidth: 0 }}>
              <div className="t">{s.label}</div>
              <div className="m">
                {state !== 'todo' && s.doneAt ? fmt(s.doneAt) : s.eta ? `Expected ${s.eta}` : state === 'todo' ? 'Waiting' : ''}
                {!compact && s.detail && (state === 'now' || state === 'todo') ? <>{(s.doneAt || s.eta || state === 'todo') ? ' · ' : ''}{s.detail}</> : null}
              </div>
              {s.note && (state !== 'todo') && <div className="note">{s.note}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Join the batch's list. With a reward, the code goes to the inbox (a guest
 * could type any address); a signed-in member with a confirmed email sees it
 * here as well.
 */
export function SignupPanel({ slug, reward, source = 'PAGE', closed = false, dark = false }: {
  slug: string; reward: GroupBuyReward | null; source?: 'PAGE' | 'POPUP' | 'HOME'; closed?: boolean; dark?: boolean;
}) {
  const { member } = useMemberSession();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<SignupResult | null>(null);
  const [filled, setFilled] = useState(false);
  if (member && !filled) { setFilled(true); setEmail(member.email); setName(member.displayName); }

  if (closed) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setDone(await signupGroupBuy(slug, { email, name: name || undefined, source }));
    } catch (err) {
      const m = (err as { response?: { data?: { error?: string; details?: { message?: string }[] } } })?.response?.data;
      setError(m?.details?.[0]?.message || m?.error || 'Could not sign you up. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`gbp-panel pad ${dark ? 'gbp-ink' : ''}`}>
      <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><Gift size={14} /> {reward ? 'Sign-up reward' : 'Join the list'}</div>
      <div className="h2" style={{ marginBottom: 6 }}>{reward ? rewardHeadline(reward) : 'Get batch updates by email'}</div>
      {done ? (
        <div style={{ marginTop: 14 }}>
          <div className="gbp-note good"><Check size={16} /><span>{done.status === 'already' ? 'You’re already on the list.' : 'You’re on the list.'} {done.reward ? 'Your code is on its way to your inbox.' : 'We’ll email you as the batch moves.'}</span></div>
          {done.reward?.code && (
            <div style={{ marginTop: 12 }}>
              <div className="gbp-code-box"><span>{done.reward.code}</span><span className="tiny muted" style={{ fontFamily: 'var(--sans)', letterSpacing: 0 }}>{rewardOff({ type: done.reward.type as GroupBuyReward['type'], value: done.reward.value })}</span></div>
              <p className="tiny muted" style={{ marginTop: 6 }}>Single use, for {email}. Enter it at checkout.</p>
            </div>
          )}
          {done.rewardNeedsMember && (
            <p className="small" style={{ marginTop: 12 }}>The reward is for members. <Link className="link" href={`/account/register?next=/group-buy/${slug}`}>Create an account</Link> with this email, then join again.</p>
          )}
        </div>
      ) : (
        <form onSubmit={submit} style={{ marginTop: 14, display: 'grid', gap: 10 }}>
          <input className="gbp-input" type="text" autoComplete="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
          <input className="gbp-input" type="email" required autoComplete="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address" />
          {error && <p className="gbp-err">{error}</p>}
          <button className={`gbp-btn ${dark ? 'signal' : 'primary'} block`} disabled={busy || !email}>{busy ? 'Joining…' : reward ? `Join and get ${rewardOff(reward)}` : 'Join the list'}</button>
          <p className="tiny muted" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <Mail size={13} style={{ flex: 'none', marginTop: 2 }} />
            {reward
              ? `Your code is emailed to you — single use, tied to your address${reward.validDays ? `, valid ${reward.validDays} days` : ''}${reward.minOrder ? `, on orders over RM${(reward.minOrder / 100).toFixed(0)}` : ''}.`
              : 'Only batch emails. No newsletter unless you ask for it.'}
            {reward?.membersOnly && !member ? ' Members only — sign in first.' : ''}
          </p>
        </form>
      )}
    </div>
  );
}
