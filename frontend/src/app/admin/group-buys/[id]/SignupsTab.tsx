'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Plus, Search, Trash2, UserCheck } from 'lucide-react';
import {
  adminAddGroupBuySignup, adminDeleteGroupBuySignup, adminDownloadSignupsCsv, adminGroupBuySignups, adminUpdateGroupBuySignup, errorText,
  type AdminGroupBuy, type AdminSignupRow,
} from '@/lib/group-buy-api';
import { formatPrice, cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card, Field, TextInput } from '@/components/admin/ui';
import { ConfirmDialog, Dialog } from '@/components/admin/Dialog';
import { shortDateTime } from '../shared';

const SOURCE: Record<string, string> = { PAGE: 'Batch page', POPUP: 'Popup', HOME: 'Home page', CHECKOUT: 'Bought', ADMIN: 'Added by team' };

/**
 * Everyone on the batch's list: who joined, from where, whether they are a
 * member, their reward code and whether they have bought.
 */
export function SignupsTab({ gb, token }: { gb: AdminGroupBuy; token: string }) {
  const [rows, setRows] = useState<AdminSignupRow[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'bought' | 'not'>('all');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AdminSignupRow | null>(null);

  const load = useCallback(() => { adminGroupBuySignups(token, gb.id).then(setRows).catch(() => setRows([])); }, [token, gb.id]);
  useEffect(load, [load]);

  const shown = useMemo(() => (rows ?? []).filter((r) => {
    if (filter === 'bought' && r.paidTotal === 0) return false;
    if (filter === 'not' && r.paidTotal > 0) return false;
    if (!q) return true;
    return `${r.email} ${r.name ?? ''} ${r.phone ?? ''} ${r.reward?.code ?? ''}`.toLowerCase().includes(q.toLowerCase());
  }), [rows, q, filter]);

  const exportCsv = async () => {
    const blob = await adminDownloadSignupsCsv(token, gb.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `group-buy-${gb.slug}-signups.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const bought = (rows ?? []).filter((r) => r.paidTotal > 0).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone, code" className="pl-9" />
        </div>
        {(['all', 'bought', 'not'] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={cn('rounded-full border px-3 py-1 text-[13px]', filter === f ? 'border-text-primary bg-text-primary text-white' : 'border-border text-text-secondary hover:text-text-primary')}>
            {f === 'all' ? `All (${rows?.length ?? 0})` : f === 'bought' ? `Bought (${bought})` : `Not yet (${(rows?.length ?? 0) - bought})`}
          </button>
        ))}
        <div className="grow" />
        <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!rows?.length}><Download className="w-4 h-4" /> Export CSV</Button>
        <Button size="sm" onClick={() => setAdding(true)}><Plus className="w-4 h-4" /> Add person</Button>
      </div>

      {rows === null ? (
        <div className="h-40 rounded-[10px] bg-surface-elevated animate-pulse" />
      ) : rows.length === 0 ? (
        <Card className="px-6 py-10 text-center text-[14px] text-text-secondary">Nobody has joined yet. The popup, banner and home section bring people here.</Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-[14px]">
            <thead className="text-left text-[12px] text-text-secondary">
              <tr className="border-b border-border">
                <th className="px-5 py-2.5 font-medium">Person</th><th className="px-3 py-2.5 font-medium">Joined</th><th className="px-3 py-2.5 font-medium">Reward</th>
                <th className="px-3 py-2.5 font-medium">Orders</th><th className="px-3 py-2.5 font-medium">Note</th><th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-border align-top last:border-0">
                  <td className="px-5 py-3">
                    <p className="flex items-center gap-1.5 text-text-primary">
                      {r.name || r.email}
                      {r.member && <span title={r.member.emailVerified ? 'Member, email confirmed' : 'Member, email not confirmed'}><UserCheck className={cn('h-3.5 w-3.5', r.member.emailVerified ? 'text-success' : 'text-text-muted')} /></span>}
                    </p>
                    <p className="text-[12px] text-text-secondary">{r.name ? r.email : ''}{r.phone ? `${r.name ? ' · ' : ''}${r.phone}` : ''}</p>
                  </td>
                  <td className="px-3 py-3 text-[13px]">
                    <p>{SOURCE[r.source] ?? r.source}</p>
                    <p className="text-[12px] text-text-secondary">{shortDateTime(r.createdAt)}</p>
                  </td>
                  <td className="px-3 py-3 text-[13px]">
                    {r.reward ? (
                      <>
                        <p className="font-mono text-[12px]">{r.reward.code}</p>
                        <p className={cn('text-[12px]', r.reward.used ? 'text-success' : !r.reward.active ? 'text-text-muted' : 'text-text-secondary')}>
                          {r.reward.label} · {r.reward.used ? 'used' : !r.reward.active ? 'cancelled' : r.reward.expiresAt && new Date(r.reward.expiresAt) < new Date() ? 'expired' : 'not used'}
                        </p>
                      </>
                    ) : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-3 py-3 text-[13px]">
                    {r.orders.length === 0 ? <span className="text-text-muted">—</span> : r.orders.map((o) => (
                      <p key={o.id}><Link href={`/admin/orders/${o.id}`} className="hover:underline">{o.orderNumber}</Link> <span className="text-text-secondary">· {formatPrice(o.total)} · {o.paymentStatus.toLowerCase()}</span></p>
                    ))}
                  </td>
                  <td className="px-3 py-3"><NoteCell row={r} save={(note) => adminUpdateGroupBuySignup(token, gb.id, r.id, note)} /></td>
                  <td className="pr-3 pt-2.5">
                    <button type="button" aria-label="Remove from list" onClick={() => setRemoving(r)} className="flex h-8 w-8 items-center justify-center rounded text-text-secondary hover:bg-surface-elevated hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {adding && <AddDialog gb={gb} token={token} onClose={() => setAdding(false)} onDone={load} />}
      {removing && (
        <ConfirmDialog
          title="Remove from the list?"
          body={`${removing.email} comes off this batch’s list.${removing.reward && !removing.reward.used ? ' Their unused reward code is cancelled.' : ''} Orders are not touched.`}
          confirmLabel="Remove"
          tone="danger"
          onClose={() => setRemoving(null)}
          onConfirm={async () => { await adminDeleteGroupBuySignup(token, gb.id, removing.id); load(); }}
        />
      )}
    </div>
  );
}

function NoteCell({ row, save }: { row: AdminSignupRow; save: (note: string | null) => Promise<unknown> }) {
  const [v, setV] = useState(row.note ?? '');
  const [savedNote, setSavedNote] = useState(row.note ?? '');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={v}
        onChange={(e) => { setV(e.target.value); setState('idle'); }}
        onBlur={async () => {
          if (savedNote === v) return;
          setState('saving');
          await save(v.trim() || null).catch(() => {});
          setSavedNote(v);
          setState('saved');
        }}
        placeholder="Add a note"
        className="h-8 w-40 rounded-[6px] border border-transparent bg-transparent px-2 text-[13px] hover:border-border focus:border-primary focus:outline-none"
      />
      {state === 'saved' && <span className="text-[12px] text-success">Saved</span>}
    </div>
  );
}

function AddDialog({ gb, token, onClose, onDone }: { gb: AdminGroupBuy; token: string; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="Add someone to the list"
      description={gb.rewardEnabled && gb.rewardValue > 0 ? 'They get the sign-up reward by email, like anyone who joins.' : 'They get the batch welcome email.'}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
          <Button size="sm" disabled={busy || !email} onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await adminAddGroupBuySignup(token, gb.id, { email, name: name || undefined, phone: phone || undefined });
              onDone();
              close();
            } catch (e) { setError(errorText(e, 'Could not add them.')); }
            finally { setBusy(false); }
          }}>Add</Button>
        </>
      )}
    >
      <div className="space-y-4">
        <Field label="Email"><TextInput type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Phone"><TextInput value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        {error && <p className="text-[13px] text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}
