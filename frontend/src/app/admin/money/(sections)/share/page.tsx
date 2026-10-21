'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Truck, Undo2, Pencil, History, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminCreateShareOut, adminDeleteShareOut, adminGetMoneyOverview, adminGetShareOut, adminGetSplitRules } from '@/lib/api';
import { formatShortDate, cn } from '@/lib/utils';
import { Card, CardHeader, Field, SaveBar, TextInput } from '@/components/admin/ui';
import { ConfirmDialog, Dialog } from '@/components/admin/Dialog';
import { Button } from '@/components/ui/Button';
import type { MoneyOverview, ShareOutQueue, SplitRule } from '@/types';
import { apiError, bpsLabel, mytDayOrNow, signedPrice, SplitBar, SplitLegend, todayIso, rm } from '../../money-ui';
import { SplitRuleDialog } from '../../SplitRuleDialog';

export default function ShareOutPage() {
  const { token } = useAuth();
  const [queue, setQueue] = useState<ShareOutQueue | null>(null);
  const [rules, setRules] = useState<{ current: SplitRule | null; rules: SplitRule[] } | null>(null);
  const [overview, setOverview] = useState<MoneyOverview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editingRule, setEditingRule] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [undoing, setUndoing] = useState<ShareOutQueue['runs'][number] | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    Promise.all([adminGetShareOut(token), adminGetSplitRules(token), adminGetMoneyOverview(token)])
      .then(([q, r, o]) => {
        setQueue(q);
        setRules(r);
        setOverview(o);
        setSelected(new Set(q.ready.map((x) => x.id)));
        setError(false);
      })
      .catch(() => setError(true));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // Columns: everyone who appears in any ready order's split, people first.
  const columns = useMemo(() => {
    const seen = new Map<string, { partnerId: string; name: string; kind: string }>();
    for (const o of queue?.ready ?? []) for (const p of o.parts) if (!seen.has(p.partnerId)) seen.set(p.partnerId, p);
    return [...seen.values()].sort((a, b) => Number(a.kind === 'COMPANY') - Number(b.kind === 'COMPANY') || a.name.localeCompare(b.name));
  }, [queue]);

  const totals = useMemo(() => {
    const t = new Map<string, number>();
    let profit = 0;
    for (const o of queue?.ready ?? []) {
      if (!selected.has(o.id)) continue;
      profit += o.profit ?? 0;
      for (const p of o.parts) t.set(p.partnerId, (t.get(p.partnerId) ?? 0) + (p.amount ?? 0));
    }
    return { byPartner: t, profit };
  }, [queue, selected]);

  if (error && !queue) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-text-secondary mb-3">Could not load profit sharing.</p>
        <Button variant="outline" size="sm" onClick={load}>Try again</Button>
      </Card>
    );
  }
  if (!queue || !rules || !overview) return <div className="h-72 rounded-[10px] bg-surface-elevated animate-pulse" />;

  const ready = queue.ready;
  const allSelected = ready.length > 0 && ready.every((o) => selected.has(o.id));
  const payPeople = columns.filter((c) => c.kind !== 'COMPANY').map((c) => ({ ...c, amount: totals.byPartner.get(c.partnerId) ?? 0 }));
  const payTotal = payPeople.reduce((s, p) => s + p.amount, 0);
  const keep = columns.filter((c) => c.kind === 'COMPANY').reduce((s, c) => s + (totals.byPartner.get(c.partnerId) ?? 0), 0);
  const upcoming = rules.rules.filter((r) => new Date(r.effectiveFrom) > new Date());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-5">
      {notice && (
        <div className="rounded-[10px] border border-success/30 bg-success/10 px-4 py-3 text-[14px] text-text-primary" role="status">{notice}</div>
      )}

      {/* ---------------- the rule */}
      <Card>
        <CardHeader
          title="Default split"
          description="Every paid order gets the split in effect on the day it was paid. Change one order on its Profit Sharing tab."
          actions={
            <>
              <Button variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)}><History className="w-3.5 h-3.5" /> History</Button>
              <Button variant="outline" size="sm" onClick={() => setEditingRule(true)}><Pencil className="w-3.5 h-3.5" /> Change</Button>
            </>
          }
          className="flex-wrap"
        />
        <div className="grid gap-5 px-6 py-5 md:grid-cols-2">
          <div>
            <p className="text-[12px] font-medium uppercase tracking-wider text-text-muted mb-2">
              Now{rules.current ? ` · since ${new Date(rules.current.effectiveFrom).getFullYear() < 2000 ? 'the start' : formatShortDate(rules.current.effectiveFrom)}` : ''}
            </p>
            {rules.current ? (
              <>
                <SplitBar shares={rules.current.shares} />
                <SplitLegend shares={rules.current.shares} />
              </>
            ) : (
              <p className="text-[14px] text-text-secondary">No default — orders get no split until one is set.</p>
            )}
          </div>
          {upcoming.length > 0 && (
            <div>
              {upcoming.map((r) => (
                <div key={r.id}>
                  <p className="text-[12px] font-medium uppercase tracking-wider text-text-muted mb-2">From {formatShortDate(r.effectiveFrom)}</p>
                  <SplitBar shares={r.shares} />
                  <SplitLegend shares={r.shares} />
                </div>
              ))}
            </div>
          )}
        </div>
        {showHistory && (
          <ul className="border-t border-border divide-y divide-border">
            {rules.rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 px-6 py-2.5 text-[13px]">
                <span className="font-medium">
                  {new Date(r.effectiveFrom).getFullYear() < 2000 ? 'From the start' : `From ${formatShortDate(r.effectiveFrom)}`}
                  <span className="ml-2 font-normal text-text-secondary">{r.shares.map((s) => `${s.name} ${bpsLabel(s.shareBps)}`).join(' · ')}</span>
                </span>
                <span className="text-text-muted">{r.note ? `${r.note} · ` : ''}{r.createdBy ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------------- ready */}
      <Card>
        <CardHeader
          title="Ready to share"
          description={
            ready.length === 0
              ? 'Nothing waiting. Orders join once they are paid, delivered and costed.'
              : `${ready.length} paid, delivered and costed order${ready.length === 1 ? '' : 's'} not shared out yet`
          }
        />
        {ready.length > 0 && (
          <>
            <div className="sm:hidden divide-y divide-border">
              {ready.map((o) => (
                <label key={o.id} className="flex items-start gap-3 px-4 py-3 cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={selected.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Include ${o.orderNumber}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <Link href={`/admin/orders/${o.id}`} className="font-medium text-[14px] hover:underline">{o.orderNumber}</Link>
                      <span className="text-[14px] tabular-nums font-semibold">{signedPrice(o.profit ?? 0)}</span>
                    </div>
                    <p className="text-[12px] text-text-secondary truncate">{o.customerName} · paid {formatShortDate(o.paidAt)}</p>
                    <p className="mt-1 text-[12px] text-text-secondary">
                      {o.parts.map((p) => `${p.kind === 'COMPANY' ? 'Ascend' : p.name} ${rm(p.amount ?? 0)}`).join(' · ')}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-muted">
                    <th className="pl-6 pr-2 py-2.5 w-10 text-left">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(ready.map((o) => o.id)))}
                        aria-label="Select all"
                      />
                    </th>
                    <th className="px-2 py-2.5 text-left font-medium">Order</th>
                    <th className="px-3 py-2.5 text-right font-medium">Profit</th>
                    {columns.map((c) => (
                      <th key={c.partnerId} className={cn('px-3 py-2.5 text-right font-medium', c.kind === 'COMPANY' && 'text-success')}>
                        {c.kind === 'COMPANY' ? 'Ascend keeps' : c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {ready.map((o) => (
                    <tr key={o.id} className={cn('hover:bg-surface-elevated/60', !selected.has(o.id) && 'opacity-50')}>
                      <td className="pl-6 pr-2 py-2.5">
                        <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Include ${o.orderNumber}`} />
                      </td>
                      <td className="px-2 py-2.5">
                        <Link href={`/admin/orders/${o.id}`} className="font-medium hover:underline">{o.orderNumber}</Link>
                        <span className="ml-2 text-[12px] text-text-secondary">{o.customerName} · {formatShortDate(o.paidAt)}</span>
                      </td>
                      <td className={cn('px-3 py-2.5 text-right tabular-nums', (o.profit ?? 0) < 0 && 'text-danger')}>{signedPrice(o.profit ?? 0)}</td>
                      {columns.map((c) => {
                        const part = o.parts.find((p) => p.partnerId === c.partnerId);
                        return (
                          <td key={c.partnerId} className={cn('px-3 py-2.5 text-right tabular-nums', c.kind === 'COMPANY' && 'text-text-secondary')}>
                            {part ? (
                              <span title={bpsLabel(part.shareBps)}>{signedPrice(part.amount ?? 0)}</span>
                            ) : (
                              <span className="text-text-muted">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border font-semibold">
                    <td />
                    <td className="px-2 py-3">{selected.size} selected</td>
                    <td className="px-3 py-3 text-right tabular-nums">{signedPrice(totals.profit)}</td>
                    {columns.map((c) => (
                      <td key={c.partnerId} className={cn('px-3 py-3 text-right tabular-nums', c.kind === 'COMPANY' && 'text-success')}>
                        {signedPrice(totals.byPartner.get(c.partnerId) ?? 0)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </Card>

      {ready.length > 0 && (
        <SaveBar>
          <div className="min-w-0 flex-1 text-[14px]">
            {selected.size === 0 ? (
              <span className="text-text-secondary">Tick the orders to share out.</span>
            ) : (
              <>
                <span className="font-semibold">Pay {rm(payTotal)}</span>
                <span className="text-text-secondary">
                  {' '}— {payPeople.filter((p) => p.amount > 0).map((p) => `${p.name} ${rm(p.amount)}`).join(', ')}
                  {keep !== 0 && ` · Ascend keeps ${rm(keep)}`}
                </span>
              </>
            )}
          </div>
          <Button size="sm" disabled={selected.size === 0} onClick={() => setConfirming(true)}>Share out…</Button>
        </SaveBar>
      )}

      {/* ---------------- waiting */}
      {(queue.waiting.needsCosting.length > 0 || queue.waiting.needsSplit.length > 0 || queue.waiting.onTheWay.length > 0) && (
        <Card>
          <CardHeader title="Not ready yet" />
          <div className="grid gap-4 px-6 py-4 sm:grid-cols-2">
            {queue.waiting.needsCosting.length > 0 && (
              <div>
                <p className="flex items-center gap-2 text-[14px] font-medium"><ClipboardList className="w-4 h-4 text-amber-700" /> Needs costing</p>
                <p className="text-[13px] text-text-secondary mb-2">Profit is unknown until every line has a cost.</p>
                <div className="flex flex-wrap gap-1.5">
                  {queue.waiting.needsCosting.map((o) => (
                    <Link key={o.id} href={`/admin/orders/${o.id}`} className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-medium text-amber-800 hover:underline">
                      {o.orderNumber}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {queue.waiting.needsSplit.length > 0 && (
              <div>
                <p className="flex items-center gap-2 text-[14px] font-medium"><Users className="w-4 h-4 text-amber-700" /> Split needs fixing</p>
                <p className="text-[13px] text-text-secondary mb-2">A person on the split isn’t a partner, or it doesn’t add up to 100%. Open the order and change its split.</p>
                <div className="flex flex-wrap gap-1.5">
                  {queue.waiting.needsSplit.map((o) => (
                    <Link key={o.id} href={`/admin/orders/${o.id}`} className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-medium text-amber-800 hover:underline">
                      {o.orderNumber}
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {queue.waiting.onTheWay.length > 0 && (
              <div>
                <p className="flex items-center gap-2 text-[14px] font-medium"><Truck className="w-4 h-4 text-text-secondary" /> On the way</p>
                <p className="text-[13px] text-text-secondary mb-2">Costed — they join once delivered.</p>
                <div className="flex flex-wrap gap-1.5">
                  {queue.waiting.onTheWay.map((o) => (
                    <Link key={o.id} href={`/admin/orders/${o.id}`} className="rounded-full bg-surface-elevated px-2.5 py-0.5 text-[12px] font-medium text-text-secondary hover:underline">
                      {o.orderNumber}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ---------------- past */}
      <Card>
        <CardHeader title="Past share-outs" />
        {queue.runs.length === 0 ? (
          <p className="px-6 py-5 text-[14px] text-text-secondary">None yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {queue.runs.map((r) => (
              <li key={r.id} id={`run-${r.id}`} className="px-6 py-3.5 scroll-mt-24">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">
                      {formatShortDate(r.occurredAt)}{r.orders.length > 0 && ` · ${r.orders.length} order${r.orders.length === 1 ? '' : 's'}`}
                      {r.legacy ? (
                        <span className="ml-2 rounded-full bg-surface-elevated px-2 py-0.5 text-[11px] font-medium text-text-secondary">Paid outside the system</span>
                      ) : (
                        <span className="ml-2 tabular-nums">{rm(r.total)} paid</span>
                      )}
                    </p>
                    {r.payouts.length > 0 && (
                      <p className="text-[13px] text-text-secondary">{r.payouts.map((p) => `${p.name} ${rm(p.amount)}`).join(' · ')}</p>
                    )}
                    <p className="text-[12px] text-text-muted">
                      {[r.note, r.createdBy === 'cutover' ? 'moved over when the bank started' : r.createdBy ? `by ${r.createdBy}` : null].filter(Boolean).join(' · ')}
                    </p>
                    {r.orders.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[12px] text-text-secondary hover:text-text-primary">Orders</summary>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {r.orders.map((o) => (
                          <Link key={o.id} href={`/admin/orders/${o.id}`} className="rounded-full bg-surface-elevated px-2 py-0.5 text-[12px] hover:underline">{o.orderNumber}</Link>
                        ))}
                      </div>
                    </details>
                    )}
                  </div>
                  {r.createdBy !== 'cutover' && (
                    <Button variant="ghost" size="sm" onClick={() => { setUndoError(null); setUndoing(r); }}>
                      <Undo2 className="w-3.5 h-3.5" /> Undo
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {confirming && (
        <ShareOutDialog
          orderIds={[...selected]}
          orders={ready.filter((o) => selected.has(o.id))}
          people={payPeople}
          keep={keep}
          bankStartedAt={overview.bank.startedAt}
          bankBalance={overview.bank.started ? overview.bank.balance : null}
          onClose={() => setConfirming(false)}
          onDone={(msg) => { setNotice(msg); load(); }}
        />
      )}
      {editingRule && (
        <SplitRuleDialog
          current={upcoming[0] ?? rules.current}
          partners={[
            ...overview.partners.filter((p) => p.active).map((p) => ({ partnerId: p.partnerId, name: p.name, kind: 'PERSON' as const })),
            ...(overview.ascend ? [{ partnerId: overview.ascend.partnerId, name: overview.ascend.name, kind: 'COMPANY' as const }] : []),
          ]}
          onClose={() => setEditingRule(false)}
          onSaved={load}
        />
      )}
      {undoing && (
        <ConfirmDialog
          title="Undo this share-out?"
          body={
            undoing.legacy
              ? `Its ${undoing.orders.length} order${undoing.orders.length === 1 ? '' : 's'} go back to Ready to share.`
              : `The ${rm(undoing.total)} of payouts are deleted and its ${undoing.orders.length} order${undoing.orders.length === 1 ? '' : 's'} go back to Ready to share. Only do this if the money did not actually go out.`
          }
          confirmLabel="Undo"
          tone="danger"
          error={undoError}
          onConfirm={async () => {
            if (!token) return false;
            try {
              await adminDeleteShareOut(token, undoing.id);
              setNotice(null);
              load();
            } catch (err) {
              setUndoError(apiError(err, 'Could not undo.'));
              return false;
            }
          }}
          onClose={() => setUndoing(null)}
        />
      )}
    </div>
  );
}

function ShareOutDialog({
  orderIds, orders, people, keep, bankStartedAt, bankBalance, onClose, onDone,
}: {
  orderIds: string[];
  orders: ShareOutQueue['ready'];
  people: { partnerId: string; name: string; amount: number }[];
  keep: number;
  bankStartedAt: string | null;
  bankBalance: number | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { token } = useAuth();
  // Orders paid before the bank existed were usually settled the old way —
  // money that never sat in Ascend's bank can't come out of it.
  const beforeBank = bankStartedAt ? orders.filter((o) => new Date(o.paidAt) < new Date(bankStartedAt)).length : orders.length;
  const [outside, setOutside] = useState(beforeBank === orders.length && orders.length > 0);
  const [day, setDay] = useState(todayIso());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = people.reduce((s, p) => s + p.amount, 0);

  const submit = async (close: () => void) => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const res = await adminCreateShareOut(token, {
        orderIds,
        occurredAt: mytDayOrNow(day),
        note: note.trim() || null,
        outsideSystem: outside,
      });
      onDone(
        outside
          ? `${res.orders} order${res.orders === 1 ? '' : 's'} marked shared (paid outside the system).`
          : `Shared out ${rm(total)} from ${res.orders} order${res.orders === 1 ? '' : 's'}.${res.warning ? ` ${res.warning}` : ''}`
      );
      close();
    } catch (err) {
      setError(apiError(err, 'Could not share out.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={`Share out ${orders.length} order${orders.length === 1 ? '' : 's'}`}
      onClose={onClose}
      size="md"
      footer={(close) => (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" form="share-out-form" size="sm" disabled={busy}>
            {busy ? 'Working…' : outside ? 'Mark shared' : `Pay ${rm(total)}`}
          </Button>
        </>
      )}
    >
      {(close) => (
      <form id="share-out-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(close); }}>
        <div className="rounded-lg border border-border divide-y divide-border">
          {people.filter((p) => p.amount !== 0).map((p) => (
            <div key={p.partnerId} className="flex justify-between px-4 py-2.5 text-[15px]">
              <span>{outside ? p.name : `Pay ${p.name}`}</span>
              <span className="font-semibold tabular-nums">{rm(p.amount)}</span>
            </div>
          ))}
          {keep !== 0 && (
            <div className="flex justify-between px-4 py-2.5 text-[14px] text-text-secondary">
              <span>Ascend keeps</span>
              <span className="tabular-nums">{rm(keep)}</span>
            </div>
          )}
        </div>

        <div role="radiogroup" aria-label="Where the money comes from" className="grid gap-2">
          {[
            { v: false, label: 'Pay from Ascend’s bank', blurb: bankBalance === null ? 'The bank is not being tracked yet.' : `Bank after: ${signedPrice(bankBalance - total)}` },
            { v: true, label: 'Already paid outside the system', blurb: 'Settled the old way. Marks the orders shared; nothing leaves the bank.' },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              role="radio"
              aria-checked={outside === o.v}
              onClick={() => setOutside(o.v)}
              className={cn('rounded-lg border px-3 py-2.5 text-left cursor-pointer', outside === o.v ? 'border-primary bg-primary/5' : 'border-border hover:bg-surface-elevated')}
            >
              <span className="block text-[14px] font-medium">{o.label}</span>
              <span className={cn('block text-[13px]', !o.v && bankBalance !== null && bankBalance - total < 0 ? 'text-amber-700' : 'text-text-secondary')}>{o.blurb}</span>
            </button>
          ))}
        </div>
        {beforeBank > 0 && beforeBank < orders.length && (
          <p className="text-[13px] text-amber-700">{beforeBank} of these were paid before the bank started — their money may never have been in it.</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Day" htmlFor="share-day">
            <TextInput id="share-day" type="date" value={day} max={todayIso()} onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field label="Note (optional)" htmlFor="share-note">
            <TextInput id="share-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. October" maxLength={300} />
          </Field>
        </div>
        {error && <p className="text-[13px] text-danger">{error}</p>}
      </form>
      )}
    </Dialog>
  );
}
