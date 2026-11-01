'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertCircle, ArrowRight, Check, Loader2, LogOut, Mail, MailCheck, Package, User } from 'lucide-react';
import type { Member } from '@/types';
import {
  memberCancelEmailChange,
  memberChangePassword,
  memberForgotPassword,
  memberRequestEmailChange,
  memberResendVerification,
  memberUpdateProfile,
  type AccountWhere,
} from '@/lib/api';
import { clearMemberSession, setMemberSession, updateMemberCache, useMemberSession } from '@/lib/member-session';
import { Field, MIN_PASSWORD, PasswordField, apiError, inputCls } from './fields';
import { GROUP_BUY_ENABLED } from '@/lib/features';

const SIGN_IN: Record<AccountWhere, { signin: string; signup: string }> = {
  store: { signin: '/account/login', signup: '/account/register' },
  'group-buy': { signin: '/group-buy/sign-in', signup: '/group-buy/join' },
};

type Status = { kind: 'ok' | 'error'; text: string } | null;

/** A 401 means the session ended (expired, or a password change elsewhere): drop it. */
function failed(err: unknown, fallback: string): string {
  if ((err as { response?: { status?: number } })?.response?.status === 401) {
    clearMemberSession();
    return 'You were signed out. Sign in again to continue.';
  }
  return apiError(err, fallback);
}

/**
 * Account settings, shared by the store (/account) and the Group Buy portal
 * (/group-buy/account): name, email (changed only once the new inbox confirms
 * it), password, and signing out.
 */
export function AccountSettings({ where }: { where: AccountWhere }) {
  const { member, token, ready, signOut } = useMemberSession();
  const pathname = usePathname() ?? '/account';

  if (!ready) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">{[180, 260, 240].map((h) => <div key={h} className="animate-pulse rounded-2xl bg-[#0A0A0A]/[0.05]" style={{ height: h }} />)}</div>
        <div className="hidden h-64 animate-pulse rounded-2xl bg-[#0A0A0A]/[0.05] lg:block" />
      </div>
    );
  }

  if (!member || !token) {
    const q = `?next=${encodeURIComponent(pathname)}`;
    return (
      <div className="max-w-xl rounded-[10px] border border-[#0A0A0A]/10 bg-white p-6 sm:p-8">
        <h2 className="font-display text-xl font-bold text-[#0A0A0A]">Sign in to manage your account.</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-[#0A0A0A]/60">Change your name, email or password once you&apos;re signed in.</p>
        <div className="mt-6 flex flex-wrap gap-2.5">
          <Link href={SIGN_IN[where].signin + q} className="inline-flex h-11 items-center rounded-full bg-[#0A0A0A] px-5 text-sm font-semibold text-white hover:bg-[#262626]">Sign in</Link>
          <Link href={SIGN_IN[where].signup + q} className="inline-flex h-11 items-center rounded-full border border-[#0A0A0A]/20 px-5 text-sm font-semibold text-[#0A0A0A] hover:border-[#0A0A0A]">Create an account</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
      <aside className="lg:order-2 lg:sticky lg:top-[88px]">
        <Identity member={member} onSignOut={signOut} />
      </aside>
      <div className="space-y-6 lg:order-1">
        {/* Keyed by member id so a different account never inherits typed values. */}
        <NameCard key={`n-${member.id}`} member={member} token={token} />
        <EmailCard key={`e-${member.id}`} member={member} token={token} where={where} />
        <PasswordCard key={`p-${member.id}`} member={member} token={token} where={where} />
      </div>
    </div>
  );
}

function Identity({ member, onSignOut }: { member: Member; onSignOut: () => void }) {
  return (
    <div className="overflow-hidden rounded-[10px] bg-[#0A0A0A] p-6 text-white">
      <div className="flex items-center gap-4">
        <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#22C55E] font-display text-2xl font-bold text-[#0A0A0A]">{member.displayName.slice(0, 1).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate font-display text-lg font-semibold">{member.displayName}</p>
          <p className="truncate text-sm text-white/60">{member.email}</p>
        </div>
      </div>
      <p className="mt-5">
        {member.emailVerified
          ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[#22C55E]/15 px-2.5 py-1 text-xs font-medium text-[#4ADE80]"><Check className="h-3.5 w-3.5" strokeWidth={3} />Email confirmed</span>
          : <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F59E0B]/15 px-2.5 py-1 text-xs font-medium text-[#FBBF24]"><AlertCircle className="h-3.5 w-3.5" />Email not confirmed</span>}
      </p>
      <div className="mt-6 grid gap-2 border-t border-white/10 pt-5">
        <Link href={GROUP_BUY_ENABLED ? '/group-buy/orders' : '/track'} className="group flex h-11 items-center gap-2.5 rounded-xl bg-white/[0.06] px-3.5 text-sm font-medium hover:bg-white/[0.1]">
          <Package className="h-4 w-4 text-white/60" />{GROUP_BUY_ENABLED ? 'My orders' : 'Track an order'}
          <ArrowRight className="ml-auto h-4 w-4 text-white/40 transition-transform duration-300 group-hover:translate-x-[3px]" />
        </Link>
        <button type="button" onClick={onSignOut} className="flex h-11 items-center gap-2.5 rounded-xl px-3.5 text-sm font-medium text-white/70 hover:bg-white/[0.06] hover:text-white cursor-pointer">
          <LogOut className="h-4 w-4" />Sign out
        </button>
      </div>
    </div>
  );
}

function Card({ title, sub, footer, onSubmit, children }: { title: string; sub: React.ReactNode; footer: React.ReactNode; onSubmit: (e: React.FormEvent) => void; children: React.ReactNode }) {
  return (
    <form onSubmit={onSubmit} className="overflow-hidden rounded-[10px] border border-[#0A0A0A]/10 bg-white">
      <div className="p-5 sm:p-6">
        <h2 className="font-display text-lg font-bold text-[#0A0A0A]">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-[#0A0A0A]/60">{sub}</p>
        <div className="mt-5">{children}</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#0A0A0A]/[0.08] bg-[#0A0A0A]/[0.025] px-5 py-3.5 sm:px-6">{footer}</div>
    </form>
  );
}

function Save({ label, busy, disabled }: { label: string; busy: boolean; disabled?: boolean }) {
  return (
    <button type="submit" disabled={busy || disabled} className="ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-[#0A0A0A] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#262626] disabled:opacity-40 disabled:hover:bg-[#0A0A0A] cursor-pointer disabled:cursor-not-allowed">
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}{label}
    </button>
  );
}

function StatusLine({ status, hint }: { status: Status; hint?: React.ReactNode }) {
  if (status) {
    return (
      <p role={status.kind === 'error' ? 'alert' : 'status'} className={`flex items-center gap-1.5 text-sm ${status.kind === 'ok' ? 'text-[#15803D]' : 'text-red-700'}`}>
        {status.kind === 'ok' ? <Check className="h-4 w-4 shrink-0" strokeWidth={3} /> : <AlertCircle className="h-4 w-4 shrink-0" />}{status.text}
      </p>
    );
  }
  return hint ? <p className="text-[13px] text-[#0A0A0A]/50">{hint}</p> : null;
}

function NameCard({ member, token }: { member: Member; token: string }) {
  const uid = useId();
  const [name, setName] = useState(member.displayName);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const trimmed = name.trim();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      updateMemberCache(await memberUpdateProfile(token, { displayName: trimmed }));
      setStatus({ kind: 'ok', text: 'Name saved.' });
    } catch (err) {
      setStatus({ kind: 'error', text: failed(err, 'Could not save your name.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Your name"
      sub="Filled in for you at checkout."
      onSubmit={submit}
      footer={<><StatusLine status={status} hint="2 to 40 characters." /><Save label="Save" busy={busy} disabled={trimmed.length < 2 || trimmed === member.displayName} /></>}
    >
      <Field id={`${uid}-name`} label="Your name" icon={User}>
        <input id={`${uid}-name`} value={name} onChange={(e) => { setName(e.target.value); setStatus(null); }} maxLength={40} autoComplete="name" required className={`${inputCls} max-w-md`} />
      </Field>
    </Card>
  );
}

function EmailCard({ member, token, where }: { member: Member; token: string; where: AccountWhere }) {
  const uid = useId();
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [resent, setResent] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      updateMemberCache(await memberRequestEmailChange(token, { newEmail: newEmail.trim(), password, where }));
      setNewEmail('');
      setPassword('');
      setStatus({ kind: 'ok', text: 'Confirmation link sent.' });
    } catch (err) {
      setStatus({ kind: 'error', text: failed(err, 'Could not start that change.') });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setStatus(null);
    try {
      updateMemberCache(await memberCancelEmailChange(token));
    } catch (err) {
      setStatus({ kind: 'error', text: failed(err, 'Could not cancel that change.') });
    }
  };

  const resend = async () => {
    try { setResent((await memberResendVerification(member.email)).message); }
    catch (err) { setResent(apiError(err, 'Could not send that right now.')); }
  };

  return (
    <Card
      title="Email"
      sub={<>You sign in with <b className="font-semibold text-[#0A0A0A]">{member.email}</b>. My orders lists the orders placed with it.</>}
      onSubmit={submit}
      footer={<><StatusLine status={status} hint="Your email only changes once you click the link we send to the new one." /><Save label="Send confirmation link" busy={busy} disabled={!newEmail || !password} /></>}
    >
      {!member.emailVerified && (
        <div className="mb-5 flex gap-2.5 rounded-xl bg-[#F59E0B]/10 px-4 py-3 text-sm text-[#92400E]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b className="font-semibold">Confirm {member.email}</b> to see orders you placed as a guest with it.{' '}
            {resent ? <span className="text-[#0A0A0A]/60">{resent}</span> : <button type="button" onClick={resend} className="font-semibold underline underline-offset-2 cursor-pointer">Resend the link</button>}
          </span>
        </div>
      )}
      {member.pendingEmail && (
        <div className="mb-5 flex gap-2.5 rounded-xl bg-[#22C55E]/10 px-4 py-3 text-sm text-[#14532D]">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            We sent a link to <b className="font-semibold">{member.pendingEmail}</b>. Click it to switch your account over.{' '}
            <button type="button" onClick={cancel} className="font-semibold underline underline-offset-2 cursor-pointer">Cancel the change</button>
          </span>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${uid}-email`} label="New email" icon={Mail} showLabel>
          <input id={`${uid}-email`} type="email" value={newEmail} onChange={(e) => { setNewEmail(e.target.value); setStatus(null); }} autoComplete="email" required placeholder="new@email.com" className={inputCls} />
        </Field>
        <PasswordField id={`${uid}-pw`} label="Current password" value={password} onChange={(v) => { setPassword(v); setStatus(null); }} showLabel placeholder="To confirm it's you" />
      </div>
    </Card>
  );
}

function PasswordCard({ member, token, where }: { member: Member; token: string; where: AccountWhere }) {
  const uid = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [mailed, setMailed] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < MIN_PASSWORD) { setStatus({ kind: 'error', text: `Use at least ${MIN_PASSWORD} characters.` }); return; }
    setBusy(true);
    setStatus(null);
    try {
      const res = await memberChangePassword(token, { currentPassword: current, newPassword: next });
      // The old token is now refused, so this device carries on with the new one.
      setMemberSession(res.token, res.member);
      setCurrent('');
      setNext('');
      setStatus({ kind: 'ok', text: 'Password updated. Other devices were signed out.' });
    } catch (err) {
      setStatus({ kind: 'error', text: failed(err, 'Could not update your password.') });
    } finally {
      setBusy(false);
    }
  };

  const mailReset = async () => {
    try {
      await memberForgotPassword(member.email, where);
      setMailed(`Reset link sent to ${member.email}.`);
    } catch (err) {
      setMailed(apiError(err, 'Could not send that right now.'));
    }
  };

  return (
    <Card
      title="Password"
      sub={<>Changing it signs you out everywhere else. Forgot the current one? {mailed ? <span className="font-medium text-[#15803D]">{mailed}</span> : <button type="button" onClick={mailReset} className="font-medium text-[#0A0A0A] underline underline-offset-2 cursor-pointer">Email me a reset link</button>}</>}
      onSubmit={submit}
      footer={<><StatusLine status={status} hint={`At least ${MIN_PASSWORD} characters.`} /><Save label="Update password" busy={busy} disabled={!current || !next} /></>}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <PasswordField id={`${uid}-cur`} label="Current password" value={current} onChange={(v) => { setCurrent(v); setStatus(null); }} showLabel placeholder="Current password" />
        <PasswordField id={`${uid}-new`} label="New password" value={next} onChange={(v) => { setNext(v); setStatus(null); }} fresh showLabel placeholder="New password" />
      </div>
    </Card>
  );
}
