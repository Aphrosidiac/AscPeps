'use client';

import { useState } from 'react';
import {
  apiError,
  DETAIL_FIELDS,
  DETAIL_LABEL,
  requestAffiliateChange,
  withdrawAffiliateChange,
  type DetailField,
  type Details,
} from '@/lib/affiliate-api';
import { Field, GuideLink, Notice, PageHead, useAff } from '../aff-ui';

/**
 * The affiliate's details, locked. Edit a section, and saving sends a change
 * request the team approves — nothing moves until then (Fakhrul, 2026-11-03:
 * a payout must never go somewhere the team hasn't seen). One request at a
 * time: editing again starts from what is already asked for, and sending
 * replaces it, so the team only sees the latest.
 */

// Malaysian banks people actually get paid into; "Other" takes a typed name.
const BANKS = [
  'Maybank', 'CIMB Bank', 'Public Bank', 'RHB Bank', 'Hong Leong Bank', 'AmBank', 'Bank Islam', 'Bank Rakyat', 'BSN',
  'Affin Bank', 'Alliance Bank', 'OCBC Bank', 'UOB', 'HSBC', 'Standard Chartered', 'Bank Muamalat', 'Agrobank',
  'GXBank', 'AEON Bank', 'Boost Bank', 'Touch ’n Go eWallet (GO+)',
];

type Section = 'bank' | 'about';
const SECTION_FIELDS: Record<Section, DetailField[]> = {
  bank: ['bankName', 'bankAccountName', 'bankAccountNumber'],
  about: ['fullName', 'phone', 'channel'],
};

const sentAt = (iso: string) =>
  new Date(iso).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function AffiliateSettings() {
  const { data, reload } = useAff();
  const a = data.affiliate!;
  const pending = data.changeRequest ?? null;
  const rejected = data.lastRejected ?? null;

  // What is approved, and what they would have if the waiting request went through.
  const approved: Details = Object.fromEntries(DETAIL_FIELDS.map((k) => [k, a[k] ?? null])) as Details;
  const wanted: Details = { ...approved, ...(pending?.changes ?? {}) };

  const [editing, setEditing] = useState<Section | null>(null);
  const [draft, setDraft] = useState<Details>(wanted);
  const [otherBank, setOtherBank] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  // Shown in the fields: the draft while editing that section, else what is approved.
  const value = (k: DetailField, section: Section) => (editing === section ? draft[k] : approved[k]) ?? '';
  const set = (k: DetailField, v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const startEdit = (section: Section) => {
    setDraft(wanted);
    setOtherBank(!!wanted.bankName && !BANKS.includes(wanted.bankName));
    setEditing(section);
    setMsg(null);
  };

  const digits = (draft.bankAccountNumber ?? '').replace(/[\s-]/g, '');
  const accError = editing === 'bank' && draft.bankAccountNumber && !/^\d{6,24}$/.test(digits) ? 'Numbers only, as on your statement.' : null;
  const nameError = editing === 'about' && (draft.fullName ?? '').trim().length < 2 ? 'Enter your full name.' : null;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setMsg(null);
    try {
      // Everything they want now: the waiting request, with this section's edits on top.
      const next: Details = { ...wanted };
      for (const k of SECTION_FIELDS[editing]) next[k] = draft[k]?.trim() || null;
      if (editing === 'bank') next.bankAccountNumber = digits || null;
      await requestAffiliateChange(next);
      await reload();
      setEditing(null);
      setMsg({ tone: 'ok', text: 'Sent. Your details stay as they are until we approve the change.' });
    } catch (err) {
      setMsg({ tone: 'bad', text: apiError(err) });
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await withdrawAffiliateChange();
      await reload();
      setEditing(null);
      setMsg({ tone: 'ok', text: 'Request withdrawn. Nothing was changed.' });
    } catch (err) {
      setMsg({ tone: 'bad', text: apiError(err) });
    } finally {
      setBusy(false);
    }
  };

  /** "Requested: CIMB Bank" under a field the waiting request changes. */
  const asked = (k: DetailField) =>
    pending && k in pending.changes && editing === null ? `Requested: ${pending.changes[k] ?? '(none)'}` : undefined;

  const head = (section: Section, title: string, sub: string) => (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="st-h fg">{title}</h2>
        <p className="st-sub mt-1">{sub}</p>
      </div>
      {editing === section ? null : (
        <button type="button" className="btn btn-soft btn-sm shrink-0" disabled={busy || editing !== null} onClick={() => startEdit(section)}>
          Edit
        </button>
      )}
    </div>
  );

  const actions = (section: Section) =>
    editing === section ? (
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-ink" disabled={busy || !!accError || !!nameError}>
          {busy ? 'Sending…' : pending ? 'Update request' : 'Request change'}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setEditing(null)}>
          Cancel
        </button>
        <p className="w-full text-[12px] leading-4 fg-3">
          {pending ? 'This replaces the change already waiting, so we only see your latest one.' : 'We check changes before they apply.'}
        </p>
      </div>
    ) : null;

  const bankChoice = otherBank ? 'Other' : draft.bankName ?? '';

  return (
    <>
      <PageHead title="Settings" sub="Your details and where we pay you" actions={<GuideLink section="details">How changes work</GuideLink>} />

      {pending ? (
        <div className="mb-5">
          <Notice tone="warn">
            <span className="block font-medium">Change waiting for approval · sent {sentAt(pending.sentAt)}</span>
            <span className="mt-1 block">
              {Object.keys(pending.changes)
                .map((k) => `${DETAIL_LABEL[k as DetailField]}: ${pending.previous[k as DetailField] ?? '(none)'} → ${pending.changes[k as DetailField] ?? '(none)'}`)
                .join(' · ')}
            </span>
            <button type="button" className="mt-2 font-medium underline underline-offset-2" disabled={busy} onClick={withdraw}>
              Withdraw it
            </button>
          </Notice>
        </div>
      ) : rejected ? (
        <div className="mb-5">
          <Notice tone="bad">
            Your last change wasn&apos;t approved{rejected.rejectReason ? `: ${rejected.rejectReason}` : '.'} Your details are as they were.
          </Notice>
        </div>
      ) : null}
      {msg ? (
        <div className="mb-5">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <form onSubmit={send} className="panel p-6 sm:p-8" noValidate>
          {head('bank', 'Bank details', 'Payouts go here. The name must match the account.')}
          <fieldset className="mt-6 grid gap-4" disabled={editing !== 'bank'}>
            <Field label="Bank" help={asked('bankName')}>
              <select
                className="input"
                value={editing === 'bank' ? bankChoice : approved.bankName && !BANKS.includes(approved.bankName) ? 'Other' : approved.bankName ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  setOtherBank(v === 'Other');
                  set('bankName', v === 'Other' ? '' : v);
                }}
              >
                <option value="">Choose your bank</option>
                {BANKS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
                <option value="Other">Other</option>
              </select>
            </Field>
            {(editing === 'bank' && otherBank) || (editing !== 'bank' && approved.bankName && !BANKS.includes(approved.bankName)) ? (
              <Field label="Bank name">
                <input className="input" value={value('bankName', 'bank')} onChange={(e) => set('bankName', e.target.value)} />
              </Field>
            ) : null}
            <Field label="Account holder name" help={asked('bankAccountName')}>
              <input className="input" value={value('bankAccountName', 'bank')} onChange={(e) => set('bankAccountName', e.target.value)} autoComplete="name" />
            </Field>
            <Field label="Account number" error={accError} help={asked('bankAccountNumber')}>
              <input className="input tnum" inputMode="numeric" value={value('bankAccountNumber', 'bank')} onChange={(e) => set('bankAccountNumber', e.target.value)} aria-invalid={!!accError} />
            </Field>
          </fieldset>
          {actions('bank')}
        </form>

        <form onSubmit={send} className="panel p-6 sm:p-8" noValidate>
          {head('about', 'About you', 'So we can reach you about payouts.')}
          <fieldset className="mt-6 grid gap-4" disabled={editing !== 'about'}>
            <Field label="Full name" error={nameError} help={asked('fullName')}>
              <input className="input" value={value('fullName', 'about')} onChange={(e) => set('fullName', e.target.value)} autoComplete="name" />
            </Field>
            <Field label="WhatsApp number" help={asked('phone')}>
              <input className="input" type="tel" inputMode="tel" value={value('phone', 'about')} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" />
            </Field>
            <Field label="Where you share your code" help={asked('channel')}>
              <input
                className="input"
                value={value('channel', 'about')}
                onChange={(e) => set('channel', e.target.value)}
                placeholder="e.g. @yourname on Instagram, a WhatsApp group, your gym"
              />
            </Field>
          </fieldset>
          <div className="mt-4">
            <Field label="Your code" help="Live codes stay as they are — every link you shared uses it. Message us if it really has to change.">
              <input className="input uppercase tracking-[0.06em]" value={a.code} disabled />
            </Field>
          </div>
          {actions('about')}
        </form>
      </div>
    </>
  );
}
