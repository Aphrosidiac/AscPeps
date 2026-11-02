'use client';

import { useState } from 'react';
import { apiError, updateMyAffiliate } from '@/lib/affiliate-api';
import { Field, Notice, PageHead, useAff } from '../aff-ui';

// Malaysian banks people actually get paid into; "Other" takes a typed name.
const BANKS = [
  'Maybank', 'CIMB Bank', 'Public Bank', 'RHB Bank', 'Hong Leong Bank', 'AmBank', 'Bank Islam', 'Bank Rakyat', 'BSN',
  'Affin Bank', 'Alliance Bank', 'OCBC Bank', 'UOB', 'HSBC', 'Standard Chartered', 'Bank Muamalat', 'Agrobank',
  'GXBank', 'AEON Bank', 'Boost Bank', 'Touch ’n Go eWallet (GO+)',
];

export default function AffiliateSettings() {
  const { data, reload } = useAff();
  const a = data.affiliate!;
  const known = !a.bankName || BANKS.includes(a.bankName);
  const [fullName, setFullName] = useState(a.fullName);
  const [phone, setPhone] = useState(a.phone);
  const [channel, setChannel] = useState(a.channel ?? '');
  const [bank, setBank] = useState(known ? a.bankName ?? '' : 'Other');
  const [otherBank, setOtherBank] = useState(known ? '' : a.bankName ?? '');
  const [accName, setAccName] = useState(a.bankAccountName ?? a.fullName.toUpperCase());
  const [accNo, setAccNo] = useState(a.bankAccountNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const bankName = bank === 'Other' ? otherBank.trim() : bank;
  const digits = accNo.replace(/[\s-]/g, '');
  const accError = accNo && !/^\d{6,24}$/.test(digits) ? 'Numbers only, as on your statement.' : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await updateMyAffiliate({
        fullName: fullName.trim(),
        phone: phone.trim(),
        channel: channel.trim() || null,
        ...(bankName && accName.trim() && digits ? { bankName, bankAccountName: accName.trim(), bankAccountNumber: digits } : {}),
      });
      await reload();
      setMsg({ tone: 'ok', text: 'Saved.' });
    } catch (err) {
      setMsg({ tone: 'bad', text: apiError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Settings" sub="Your details and where we pay you" />
      <form onSubmit={save} className="grid gap-5 lg:grid-cols-2" noValidate>
        <section className="panel p-6 sm:p-8">
          <h2 className="st-h fg">Bank details</h2>
          <p className="st-sub mt-1">Payouts go here. The name must match the account.</p>
          <div className="mt-6 grid gap-4">
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
            <Field label="Account holder name">
              <input className="input" value={accName} onChange={(e) => setAccName(e.target.value)} autoComplete="name" />
            </Field>
            <Field label="Account number" error={accError}>
              <input className="input tnum" inputMode="numeric" value={accNo} onChange={(e) => setAccNo(e.target.value)} aria-invalid={!!accError} />
            </Field>
          </div>
        </section>

        <section className="panel p-6 sm:p-8">
          <h2 className="st-h fg">About you</h2>
          <p className="st-sub mt-1">So we can reach you about payouts.</p>
          <div className="mt-6 grid gap-4">
            <Field label="Full name">
              <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
            </Field>
            <Field label="WhatsApp number">
              <input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
            </Field>
            <Field label="Where you share your code">
              <input className="input" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="e.g. @yourname on Instagram, a WhatsApp group, your gym" />
            </Field>
            <Field label="Your code" help="Live codes stay as they are — every link you shared uses it. Message us if it really has to change.">
              <input className="input uppercase tracking-[0.06em]" value={a.code} disabled />
            </Field>
          </div>
        </section>

        <div className="lg:col-span-2 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-ink" disabled={busy || !!accError || fullName.trim().length < 2}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          {msg ? <Notice tone={msg.tone}>{msg.text}</Notice> : null}
        </div>
      </form>
    </>
  );
}
