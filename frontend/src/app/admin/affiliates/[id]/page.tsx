'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useNow } from '@/lib/use-now';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/admin/Dialog';
import { Affixed, Card, CardHeader, Field, PageHeader, TextArea, TextInput } from '@/components/admin/ui';
import { cn, formatPrice } from '@/lib/utils';
import {
  ENTRY_LABEL,
  adminAdjustAffiliate,
  adminGetAffiliate,
  adminUpdateAffiliate,
  apiError,
  type AdminAffiliateDetail,
  type AffiliateStatus,
} from '@/lib/affiliate-api';
import { MarkPaidDialog, PayoutBadge, StateBadge, StatusBadge, myt, signed } from '../affiliate-admin-ui';

/** One affiliate: approve/pause, their rate, what they sold and earned, their payouts. */
export default function AdminAffiliatePage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const [d, setD] = useState<AdminAffiliateDetail | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<AffiliateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const now = useNow();
  // Bumped to re-read after a change made elsewhere on the page.
  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    if (!token) return;
    let live = true;
    adminGetAffiliate(token, id).then(
      (r) => live && (setD(r), setError('')),
      (err) => live && setError(apiError(err, 'Could not load this affiliate.'))
    );
    return () => {
      live = false;
    };
  }, [token, id, version]);

  if (error) return <p className="py-16 text-center text-sm text-danger">{error}</p>;
  if (!d || !token) return <div className="h-96 animate-pulse rounded-[10px] bg-surface-elevated" />;

  const a = d.affiliate;
  const b = d.balance;
  const open = d.payouts.find((p) => p.status === 'REQUESTED');
  const ready = !!open && now != null && new Date(open.availableAt).getTime() <= now;
  const actions: { to: AffiliateStatus; label: string; variant: 'primary' | 'outline' | 'danger' }[] =
    a.status === 'APPLIED'
      ? [{ to: 'ACTIVE', label: 'Approve', variant: 'primary' }, { to: 'REJECTED', label: 'Reject', variant: 'outline' }]
      : a.status === 'ACTIVE'
        ? [{ to: 'PAUSED', label: 'Pause code', variant: 'outline' }]
        : [{ to: 'ACTIVE', label: a.status === 'PAUSED' ? 'Switch code back on' : 'Approve after all', variant: 'primary' }];

  return (
    <div className="max-w-[1280px]">
      <PageHeader
        back="/admin/affiliates"
        title={a.fullName}
        subtitle={`${a.code} · ${a.email}${a.emailVerified ? '' : ' (email not confirmed)'} · ${a.phone}`}
        actions={
          <>
            <StatusBadge status={a.status} />
            {actions.map((x) => (
              <Button key={x.to} size="sm" variant={x.variant} onClick={() => setConfirm(x.to)}>{x.label}</Button>
            ))}
          </>
        }
      />
      {notice ? <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800">{notice}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-4">
            <Tile label="Balance" value={signed(b.balance)} tone={b.balance < 0 ? 'bad' : undefined} />
            <Tile label="Earned" value={formatPrice(b.earned)} hint={b.reversed ? `${formatPrice(b.reversed)} taken back` : undefined} />
            <Tile label="Paid out" value={formatPrice(b.paidOut)} />
            <Tile label="Waiting for payment" value={formatPrice(b.awaitingPayment)} hint={`${b.awaitingPaymentOrders} unpaid`} />
          </div>

          {open ? (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-text-primary">Payout of {formatPrice(open.amount)} asked</p>
                    <PayoutBadge status="REQUESTED" ready={ready} />
                  </div>
                  <p className="text-[13px] text-text-secondary">
                    {open.bankName} {open.bankAccountNumber} · {open.bankAccountName} · payable from {myt(open.availableAt, true)}
                  </p>
                </div>
                <Button size="sm" disabled={!ready} onClick={() => setPaying(true)}>Mark paid</Button>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Orders with their code" description="Commission is booked when an order is paid and follows it through refunds, cancels and deletes." />
            {d.orders.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-text-secondary">No orders yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-[12px] font-medium text-text-secondary">
                      <th className="px-6 py-2.5">Order</th>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5 text-right">Goods</th>
                      <th className="px-6 py-2.5 text-right">Commission</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.orders.map((o) => (
                      <tr key={o.id} className="border-b border-border last:border-0">
                        <td className="px-6 py-3">
                          <Link href={`/admin/orders/${o.id}`} className="font-medium text-text-primary hover:underline">{o.orderNumber}</Link>
                          <p className="text-[12px] text-text-secondary">{myt(o.placedAt)}</p>
                        </td>
                        <td className="px-3 py-3"><StateBadge state={o.state} /></td>
                        <td className="px-3 py-3 text-right tabular-nums">{formatPrice(o.goods)}</td>
                        <td className={cn('px-6 py-3 text-right tabular-nums', o.state === 'AWAITING_PAYMENT' && 'text-text-muted')}>
                          {formatPrice(o.commission)} <span className="text-[12px] text-text-muted">{o.rate}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Ledger" description="Every change to their balance." actions={<Button size="sm" variant="outline" onClick={() => setAdjusting(true)}>Adjust</Button>} />
            {d.entries.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-text-secondary">Nothing yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {d.entries.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-4 px-6 py-3 text-sm">
                    <div>
                      <p className="text-text-primary">
                        {ENTRY_LABEL[e.kind] === 'Paid to you' ? 'Payout' : ENTRY_LABEL[e.kind]}
                        {e.orderNumber ? <span className="text-text-secondary"> · {e.orderNumber}</span> : null}
                      </p>
                      <p className="text-[12px] text-text-muted">{myt(e.at, true)}{e.note ? ` · ${e.note}` : ''}</p>
                    </div>
                    <span className={cn('font-medium tabular-nums', e.amount > 0 ? 'text-success' : 'text-text-primary')}>
                      {e.amount > 0 ? '+' : ''}{signed(e.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <RateCard token={token} d={d} onSaved={setD} />
          <Card>
            <CardHeader title="Payout details" />
            <dl className="space-y-2 px-6 py-4 text-sm">
              <Row k="Bank" v={a.bankName || '—'} />
              <Row k="Account" v={a.bankAccountNumber || '—'} />
              <Row k="Name" v={a.bankAccountName || '—'} />
              <Row k="Shares on" v={a.channel || '—'} />
              <Row k="Applied" v={myt(a.createdAt)} />
              {a.approvedAt ? <Row k="Approved" v={`${myt(a.approvedAt)}${a.approvedBy ? ` · ${a.approvedBy}` : ''}`} /> : null}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Payouts" />
            {d.payouts.length === 0 ? (
              <p className="px-6 py-6 text-sm text-text-secondary">None yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {d.payouts.map((p) => (
                  <li key={p.id} className="flex items-start justify-between gap-3 px-6 py-3 text-sm">
                    <div>
                      <PayoutBadge status={p.status} ready={p.status === 'REQUESTED' && now != null && new Date(p.availableAt).getTime() <= now} />
                      <p className="mt-1 text-[12px] text-text-muted">
                        {p.status === 'PAID' && p.paidAt ? `${myt(p.paidAt)}${p.reference ? ` · ${p.reference}` : ''}` : p.status === 'CANCELLED' ? p.cancelReason : `asked ${myt(p.createdAt)}`}
                      </p>
                    </div>
                    <span className="font-medium tabular-nums">{formatPrice(p.paidAmount ?? p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>

      {confirm ? (
        <ConfirmDialog
          title={confirm === 'ACTIVE' ? (a.status === 'APPLIED' ? `Approve ${a.fullName}?` : `Switch ${a.code} back on?`) : confirm === 'PAUSED' ? `Pause ${a.code}?` : `Reject ${a.fullName}?`}
          body={
            confirm === 'ACTIVE'
              ? `Code ${a.code} works at checkout from now on, at ${a.commission} commission.`
              : confirm === 'PAUSED'
                ? 'The code stops working at checkout. Commission already earned stays; payouts wait until it is back on.'
                : 'Their code never goes live. They see that the application was not approved.'
          }
          confirmLabel={confirm === 'ACTIVE' ? 'Yes' : confirm === 'PAUSED' ? 'Pause' : 'Reject'}
          tone={confirm === 'ACTIVE' ? 'primary' : 'danger'}
          busy={busy}
          onConfirm={async () => {
            setBusy(true);
            try {
              setD(await adminUpdateAffiliate(token, id, { status: confirm }));
            } finally {
              setBusy(false);
            }
          }}
          onClose={() => setConfirm(null)}
        />
      ) : null}
      {adjusting ? <AdjustDialog token={token} id={id} onDone={setD} onClose={() => setAdjusting(false)} /> : null}
      {paying && open ? (
        <MarkPaidDialog
          token={token}
          payout={{ ...open, name: a.fullName, code: a.code, payableNow: Math.max(0, Math.min(open.amount, b.balance)) }}
          onDone={(note) => {
            setNotice(note);
            load();
          }}
          onClose={() => setPaying(false)}
        />
      ) : null}
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'bad' }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[12px] font-medium text-text-secondary">{label}</p>
      <p className={cn('mt-1 font-display text-[20px] font-semibold tabular-nums', tone === 'bad' && 'text-danger')}>{value}</p>
      {hint ? <p className="text-[12px] text-text-muted">{hint}</p> : null}
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-secondary">{k}</dt>
      <dd className="text-right font-medium text-text-primary break-all">{v}</dd>
    </div>
  );
}

function RateCard({ token, d, onSaved }: { token: string; d: AdminAffiliateDetail; onSaved: (d: AdminAffiliateDetail) => void }) {
  const a = d.affiliate;
  const [rate, setRate] = useState(String(a.rateBps / 100));
  const [note, setNote] = useState(a.adminNote ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const bps = Math.round(Number(rate) * 100);
  const dirty = bps !== a.rateBps || note !== (a.adminNote ?? '');
  return (
    <Card>
      <CardHeader title="Commission" description="Applies to orders placed from now on; earlier orders keep their rate." />
      <div className="space-y-4 px-6 py-4">
        <Field label="Rate">
          <Affixed suffix="%">
            <input type="number" min={0} max={50} step={0.5} value={rate} onChange={(e) => (setRate(e.target.value), setMsg(null))} />
          </Affixed>
        </Field>
        <Field label="Team note" help="Only the team sees this.">
          <TextArea rows={3} value={note} onChange={(e) => (setNote(e.target.value), setMsg(null))} />
        </Field>
        <div className="flex items-center justify-between gap-3">
          {msg ? <p className={cn('text-[13px]', msg.ok ? 'text-success' : 'text-danger')}>{msg.text}</p> : <span />}
          <Button
            size="sm"
            disabled={!dirty || busy || !Number.isFinite(bps)}
            onClick={async () => {
              setBusy(true);
              try {
                onSaved(await adminUpdateAffiliate(token, a.id, { rateBps: bps, adminNote: note.trim() || null }));
                setMsg({ ok: true, text: 'Saved.' });
              } catch (err) {
                setMsg({ ok: false, text: apiError(err) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AdjustDialog({ token, id, onDone, onClose }: { token: string; id: string; onDone: (d: AdminAffiliateDetail) => void; onClose: () => void }) {
  const [amount, setAmount] = useState('');
  const [dir, setDir] = useState<'add' | 'take'>('add');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sen = Math.round(Number(amount) * 100);
  return (
    <Dialog
      title="Adjust balance"
      description="A correction by hand, kept on the ledger with your reason."
      onClose={onClose}
      footer={(close) => (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || !(sen > 0) || note.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              try {
                onDone(await adminAdjustAffiliate(token, id, { amount: dir === 'add' ? sen : -sen, note: note.trim() }));
                close();
              } catch (err) {
                setError(apiError(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {dir === 'add' ? 'Add' : 'Take off'}
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          {(['add', 'take'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setDir(k)}
              className={cn('h-9 flex-1 rounded-lg text-sm font-medium cursor-pointer', dir === k ? 'bg-text-primary text-white' : 'bg-surface-elevated text-text-secondary')}
            >
              {k === 'add' ? 'Add to balance' : 'Take off balance'}
            </button>
          ))}
        </div>
        <Field label="Amount">
          <Affixed prefix="RM">
            <input type="number" min={0} step={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} data-autofocus />
          </Affixed>
        </Field>
        <Field label="Why">
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Order made by phone with their code" />
        </Field>
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </div>
    </Dialog>
  );
}
