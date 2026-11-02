'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, Handshake, Search } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/admin/Dialog';
import { Affixed, Card, CardHeader, Field, PageHeader, SaveBar, TabBar, TextInput, Toggle } from '@/components/admin/ui';
import { cn, formatPrice } from '@/lib/utils';
import {
  adminCancelAffiliatePayout,
  adminGetAffiliateSettings,
  adminListAffiliatePayouts,
  adminListAffiliates,
  adminSaveAffiliateSettings,
  adminUpdateAffiliate,
  apiError,
  type AdminAffiliateRow,
  type AdminPayoutRow,
  type AffiliateSettings,
  type AffiliateStatus,
  type PayoutStatus,
} from '@/lib/affiliate-api';
import { AFFILIATE_URL } from '@/lib/affiliate-url';
import { MarkPaidDialog, PayoutBadge, StatusBadge, myt, signed } from './affiliate-admin-ui';

/**
 * Admin → Affiliates (docs/affiliate.md): who applied and who sells, the
 * payouts to transfer, and the programme's numbers. The affiliates themselves
 * use affiliate.ascendpeptides.my.
 */

type Tab = 'affiliates' | 'payouts' | 'settings';

export default function AdminAffiliatesPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<Tab>('affiliates');
  const [waiting, setWaiting] = useState<{ approve: number; pay: number }>({ approve: 0, pay: 0 });
  // Stable, or each tab's loader would re-run on every render.
  const onApprove = useCallback((approve: number) => setWaiting((w) => ({ ...w, approve })), []);
  const onPay = useCallback((pay: number) => setWaiting((w) => ({ ...w, pay })), []);

  // The payouts count shows on its tab before anyone opens it.
  useEffect(() => {
    if (!token) return;
    adminListAffiliatePayouts(token).then((r) => onPay(r.payouts.length), () => {});
  }, [token, onPay]);

  return (
    <div className="max-w-[1280px]">
      <PageHeader
        title="Affiliates"
        icon={Handshake}
        subtitle="People who share a code for commission"
        actions={
          <a href={AFFILIATE_URL} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary underline underline-offset-4">
            Open the affiliate site
          </a>
        }
      />
      <TabBar<Tab>
        className="mb-6"
        current={tab}
        onSelect={setTab}
        tabs={[
          { id: 'affiliates', label: waiting.approve ? `Affiliates · ${waiting.approve} to approve` : 'Affiliates' },
          { id: 'payouts', label: waiting.pay ? `Payouts · ${waiting.pay} waiting` : 'Payouts' },
          { id: 'settings', label: 'Settings' },
        ]}
      />
      {!token ? null : tab === 'affiliates' ? (
        <AffiliatesTab token={token} onCounts={onApprove} />
      ) : tab === 'payouts' ? (
        <PayoutsTab token={token} onCounts={onPay} />
      ) : (
        <SettingsTab token={token} />
      )}
    </div>
  );
}

/* ── Affiliates ── */

const FILTERS: { key: '' | AffiliateStatus; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'APPLIED', label: 'To approve' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'PAUSED', label: 'Paused' },
  { key: 'REJECTED', label: 'Not approved' },
];

function AffiliatesTab({ token, onCounts }: { token: string; onCounts: (approve: number) => void }) {
  const [status, setStatus] = useState<'' | AffiliateStatus>('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<AdminAffiliateRow[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<AffiliateStatus, number>>>({});
  const [error, setError] = useState('');
  const [approving, setApproving] = useState<AdminAffiliateRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await adminListAffiliates(token, { status: status || undefined, search: search.trim() || undefined });
      setRows(r.affiliates);
      setCounts(r.counts);
      onCounts(r.counts.APPLIED ?? 0);
      setError('');
    } catch (err) {
      setError(apiError(err, 'Could not load affiliates.'));
    }
  }, [token, status, search, onCounts]);

  useEffect(() => {
    const t = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const n = f.key ? counts[f.key] ?? 0 : Object.values(counts).reduce((s, v) => s + (v ?? 0), 0);
            return (
              <button
                key={f.key || 'all'}
                type="button"
                onClick={() => setStatus(f.key)}
                className={cn(
                  'h-8 rounded-full px-3 text-[13px] font-medium cursor-pointer transition-colors',
                  status === f.key ? 'bg-text-primary text-white' : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
                )}
              >
                {f.label} <span className="opacity-60 tabular-nums">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden />
          <TextInput className="pl-9" placeholder="Name, code, phone, email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search affiliates" />
        </div>
      </div>
      {error ? (
        <p className="px-5 py-10 text-center text-sm text-danger">{error}</p>
      ) : !rows ? (
        <div className="h-48 animate-pulse" />
      ) : rows.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-text-secondary">
          {status || search ? 'Nobody matches.' : 'No affiliates yet. Switch the programme on in Settings and they can apply on the affiliate site.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[12px] font-medium text-text-secondary">
                <th className="px-5 py-2.5">Affiliate</th>
                <th className="px-3 py-2.5">Code</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="hidden px-3 py-2.5 text-right md:table-cell">Paid orders</th>
                <th className="hidden px-3 py-2.5 text-right lg:table-cell">Sales</th>
                <th className="hidden px-3 py-2.5 text-right md:table-cell">Earned</th>
                <th className="px-3 py-2.5 text-right">Balance</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0 hover:bg-surface-elevated/60">
                  <td className="px-5 py-3">
                    <Link href={`/admin/affiliates/${a.id}`} className="font-medium text-text-primary hover:underline">{a.fullName}</Link>
                    <p className="text-[12px] text-text-secondary">{a.email}</p>
                  </td>
                  <td className="px-3 py-3 font-medium tracking-wide">{a.code}</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={a.status} />
                    <p className="mt-0.5 text-[12px] text-text-secondary">{a.commission}</p>
                  </td>
                  <td className="hidden px-3 py-3 text-right tabular-nums md:table-cell">{a.paidOrders}</td>
                  <td className="hidden px-3 py-3 text-right tabular-nums lg:table-cell">{formatPrice(a.sales)}</td>
                  <td className="hidden px-3 py-3 text-right tabular-nums md:table-cell">{formatPrice(a.earned)}</td>
                  <td className={cn('px-3 py-3 text-right font-medium tabular-nums', a.balance < 0 && 'text-danger')}>
                    {signed(a.balance)}
                    {a.requested ? <p className="text-[12px] font-normal text-amber-700">{formatPrice(a.requested)} asked</p> : null}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {a.status === 'APPLIED' ? (
                      <Button size="sm" onClick={() => setApproving(a)}>Approve</Button>
                    ) : (
                      <Link href={`/admin/affiliates/${a.id}`} className="text-[13px] font-medium text-primary">Open</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {approving ? (
        <ConfirmDialog
          title={`Approve ${approving.fullName}?`}
          body={
            // The dialog puts the body in a <p>: spans only.
            <>
              <span className="block">Code <span className="font-semibold text-text-primary">{approving.code}</span> starts working at checkout now, at {approving.commission} commission.</span>
              {approving.channel ? <span className="mt-2 block">Shares on: {approving.channel}</span> : null}
              <span className="mt-2 block">{approving.phone} · {approving.email}</span>
            </>
          }
          confirmLabel="Approve"
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try {
              await adminUpdateAffiliate(token, approving.id, { status: 'ACTIVE' });
              await load();
            } finally {
              setBusy(false);
            }
          }}
          onClose={() => setApproving(null)}
        />
      ) : null}
    </Card>
  );
}

/* ── Payouts ── */

function PayoutsTab({ token, onCounts }: { token: string; onCounts: (n: number) => void }) {
  const [status, setStatus] = useState<PayoutStatus>('REQUESTED');
  const [rows, setRows] = useState<AdminPayoutRow[] | null>(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState<AdminPayoutRow | null>(null);
  const [cancelling, setCancelling] = useState<AdminPayoutRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let live = true;
    adminListAffiliatePayouts(token, status).then(
      (r) => {
        if (!live) return;
        setRows(r.payouts);
        if (status === 'REQUESTED') onCounts(r.payouts.length);
        setError('');
      },
      (err) => live && setError(apiError(err, 'Could not load payouts.'))
    );
    return () => {
      live = false;
    };
  }, [token, status, onCounts, version]);

  return (
    <Card>
      <CardHeader
        title={status === 'REQUESTED' ? 'Waiting to be paid' : status === 'PAID' ? 'Paid' : 'Cancelled'}
        description={
          status === 'REQUESTED'
            ? 'Transfer from Ascend\'s bank, then mark it paid. Each is payable once its hold has passed, so refunds land first.'
            : 'History.'
        }
        actions={
          <div className="flex gap-1.5">
            {(['REQUESTED', 'PAID', 'CANCELLED'] as PayoutStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={cn(
                  'h-8 rounded-full px-3 text-[13px] font-medium cursor-pointer',
                  status === s ? 'bg-text-primary text-white' : 'bg-surface-elevated text-text-secondary hover:text-text-primary'
                )}
              >
                {s === 'REQUESTED' ? 'Waiting' : s === 'PAID' ? 'Paid' : 'Cancelled'}
              </button>
            ))}
          </div>
        }
      />
      {notice ? <p className="border-b border-border bg-amber-50 px-6 py-2.5 text-[13px] text-amber-800">{notice}</p> : null}
      {error ? (
        <p className="px-6 py-10 text-center text-sm text-danger">{error}</p>
      ) : !rows ? (
        <div className="h-40 animate-pulse" />
      ) : rows.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-text-secondary">{status === 'REQUESTED' ? 'Nothing to pay right now.' : 'None.'}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
              <div className="min-w-[200px] flex-1">
                <div className="flex items-center gap-2">
                  <Link href={`/admin/affiliates/${p.affiliateId}`} className="font-medium text-text-primary hover:underline">{p.name}</Link>
                  <span className="text-[12px] font-medium tracking-wide text-text-secondary">{p.code}</span>
                  <PayoutBadge status={p.status} ready={p.ready} />
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-text-secondary">
                  {p.bankName} · <span className="font-medium text-text-primary tabular-nums">{p.bankAccountNumber}</span>
                  <button type="button" aria-label="Copy account number" className="cursor-pointer text-text-muted hover:text-text-primary" onClick={() => navigator.clipboard?.writeText(p.bankAccountNumber)}>
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  · {p.bankAccountName}
                </p>
                <p className="mt-0.5 text-[12px] text-text-muted">
                  {p.status === 'REQUESTED'
                    ? `Asked ${myt(p.createdAt, true)} · payable from ${myt(p.availableAt, true)}`
                    : p.status === 'PAID'
                      ? `Paid ${p.paidAt ? myt(p.paidAt, true) : ''}${p.reference ? ` · ref ${p.reference}` : ''}${p.paidBy ? ` · ${p.paidBy}` : ''}`
                      : p.cancelReason}
                </p>
              </div>
              <div className="text-right">
                <p className="text-base font-semibold tabular-nums">{formatPrice(p.status === 'PAID' ? p.paidAmount ?? p.amount : p.payableNow ?? p.amount)}</p>
                {p.status === 'REQUESTED' && p.payableNow != null && p.payableNow < p.amount ? (
                  <p className="text-[12px] text-amber-700">asked {formatPrice(p.amount)}</p>
                ) : null}
              </div>
              {p.status === 'REQUESTED' ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setCancelling(p)}>Cancel</Button>
                  <Button size="sm" disabled={!p.ready} title={p.ready ? undefined : 'Still in its hold'} onClick={() => setPaying(p)}>Mark paid</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {paying ? (
        <MarkPaidDialog
          token={token}
          payout={paying}
          onDone={(note) => {
            setNotice(note);
            load();
          }}
          onClose={() => setPaying(null)}
        />
      ) : null}
      {cancelling ? <CancelPayoutDialog token={token} payout={cancelling} onDone={load} onClose={() => setCancelling(null)} /> : null}
    </Card>
  );
}

function CancelPayoutDialog({ token, payout, onDone, onClose }: { token: string; payout: AdminPayoutRow; onDone: () => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog
      title={`Cancel ${payout.name}'s payout?`}
      description="Nothing is paid; the amount stays in their balance and they can ask again."
      onClose={onClose}
      footer={(close) => (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>Keep it</Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={busy || reason.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              try {
                await adminCancelAffiliatePayout(token, payout.id, reason.trim());
                onDone();
                close();
              } catch (err) {
                setError(apiError(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Cancel payout
          </Button>
        </>
      )}
    >
      <Field label="Why" help="Shown to the affiliate.">
        <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bank details don't match the name" data-autofocus />
      </Field>
      {error ? <p className="mt-3 text-[13px] text-danger">{error}</p> : null}
    </Dialog>
  );
}

/* ── Settings ── */

function SettingsTab({ token }: { token: string }) {
  const [saved, setSaved] = useState<AffiliateSettings | null>(null);
  const [draft, setDraft] = useState<AffiliateSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    adminGetAffiliateSettings(token).then((s) => (setSaved(s), setDraft(s)), () => setMsg({ ok: false, text: 'Could not load the settings.' }));
  }, [token]);

  if (!draft || !saved) return msg ? <p className="text-sm text-danger">{msg.text}</p> : <div className="h-64 animate-pulse rounded-[10px] bg-surface-elevated" />;

  const set = <K extends keyof AffiliateSettings>(k: K, v: AffiliateSettings[K]) => (setDraft({ ...draft, [k]: v }), setMsg(null));
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const ratePct = draft.defaultRateBps / 100;
  const over = draft.customerDiscountPct + ratePct > draft.marginBudgetPct;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Ascend Affiliate" description="Joining, codes at checkout, and the affiliate popup on the store." />
        <div className="space-y-5 p-6">
          <Toggle
            checked={draft.enabled}
            onChange={(v) => set('enabled', v)}
            label="Programme open"
            description="Off: nobody can join, every affiliate code stops working at checkout, and the popup is hidden. Balances and payouts are kept."
          />
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Customer discount" help="Off goods, with an affiliate's code.">
              <Affixed suffix="%">
                <input type="number" min={0} max={50} value={draft.customerDiscountPct} onChange={(e) => set('customerDiscountPct', num(e.target.value))} />
              </Affixed>
            </Field>
            <Field label="Commission" help="For newly approved affiliates. Each can have their own.">
              <Affixed suffix="%">
                <input type="number" min={0} max={50} step={0.5} value={ratePct} onChange={(e) => set('defaultRateBps', Math.round(num(e.target.value) * 100))} />
              </Affixed>
            </Field>
            <Field label="Margin budget" help="Discount + commission may not go over this." error={over ? `${draft.customerDiscountPct}% + ${ratePct}% is over ${draft.marginBudgetPct}%.` : null}>
              <Affixed suffix="%">
                <input type="number" min={0} max={50} value={draft.marginBudgetPct} onChange={(e) => set('marginBudgetPct', num(e.target.value))} />
              </Affixed>
            </Field>
            <Field label="Payout hold" help="Days between asking and being payable, so refunds land first.">
              <Affixed suffix="days">
                <input type="number" min={0} max={60} value={draft.holdDays} onChange={(e) => set('holdDays', num(e.target.value))} />
              </Affixed>
            </Field>
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Sign-up bonus" description="A one-time code for a new store account, and the store popup that offers it." />
        <div className="space-y-5 p-6">
          <Toggle
            checked={draft.signupBonusEnabled}
            onChange={(v) => set('signupBonusEnabled', v)}
            label="Give new accounts a first-order code"
            description="Minted when they confirm their email; single use, only with that email; can't be combined with another code."
          />
          <Field label="Bonus" className="max-w-[200px]">
            <Affixed suffix="% off">
              <input type="number" min={1} max={50} value={draft.signupBonusPct} onChange={(e) => set('signupBonusPct', num(e.target.value))} />
            </Affixed>
          </Field>
        </div>
      </Card>
      <SaveBar>
        {msg ? <p className={cn('text-sm', msg.ok ? 'text-success' : 'text-danger')}>{msg.text}</p> : <p className="text-sm text-text-secondary">{dirty ? 'Unsaved changes' : 'Saved'}</p>}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" disabled={!dirty || busy} onClick={() => (setDraft(saved), setMsg(null))}>Undo</Button>
          <Button
            size="sm"
            disabled={!dirty || busy || over || Object.values(draft).some((v) => typeof v === 'number' && Number.isNaN(v))}
            onClick={async () => {
              setBusy(true);
              try {
                const s = await adminSaveAffiliateSettings(token, draft);
                setSaved(s);
                setDraft(s);
                setMsg({ ok: true, text: 'Saved.' });
              } catch (err) {
                setMsg({ ok: false, text: apiError(err) });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </SaveBar>
    </div>
  );
}
