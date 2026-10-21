'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Plus, Landmark, UserPlus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminDeletePartner, adminGetFinanceOverview, adminSavePartners } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, CardHeader, Field, TextInput } from '@/components/admin/ui';
import { ConfirmDialog, Dialog } from '@/components/admin/Dialog';
import { Button } from '@/components/ui/Button';
import type { FinanceOverview, PartnerBalance } from '@/types';
import { RecordMoneyDialog } from '../../RecordMoneyDialog';
import { apiError, signedPrice, rm } from '../../money-ui';

export default function PartnersPage() {
  const { token } = useAuth();
  const [data, setData] = useState<FinanceOverview | null>(null);
  const [error, setError] = useState(false);
  const [recording, setRecording] = useState<string | null | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PartnerBalance | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    adminGetFinanceOverview(token)
      .then((d) => { setData(d); setError(false); })
      .catch(() => setError(true));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (error && !data) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-text-secondary mb-3">Could not load partners.</p>
        <Button variant="outline" size="sm" onClick={load}>Try again</Button>
      </Card>
    );
  }
  if (!data) return <div className="h-72 rounded-[10px] bg-surface-elevated animate-pulse" />;

  const people = data.partners;
  // Someone with nothing ever recorded (a typo that became a partner, an
  // "Investors" row nobody used) gets a line, not a card of zeroes.
  const blank = (p: PartnerBalance) =>
    p.earned === 0 && p.owed === 0 && p.paidOut === 0 && p.contributed === 0 && p.advancesTotal === 0 && p.capitalFronted === 0;
  const active = people.filter((p) => !blank(p));
  const empty = people.filter(blank);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-text-secondary">
          What each person is owed now: their share of orders not shared out yet, plus anything they lent Ascend that is not repaid.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}><UserPlus className="w-3.5 h-3.5" /> Add partner</Button>
          <Button size="sm" onClick={() => setRecording(null)}><Plus className="w-3.5 h-3.5" /> Record money</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.ascend && (
          <Card className="flex flex-col border-success/40">
            <div className="flex-1 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-[17px] font-semibold flex items-center gap-1.5"><Landmark className="w-4 h-4 text-success" /> {data.ascend.name}</p>
                  <p className="text-[12px] text-text-secondary">Its share, kept in the bank</p>
                </div>
                <span className={cn('shrink-0 whitespace-nowrap font-display text-[24px] leading-8 font-bold tabular-nums', data.ascend.retained > 0 && 'text-success')}>{signedPrice(data.ascend.retained)}</span>
              </div>
              <dl className="mt-4 space-y-1.5 border-t border-border pt-3 text-[14px]">
                <Row label="On orders not shared yet" value={rm(data.ascend.toKeep)} />
                <Row label="Partners invested" value={rm(data.totalContributed)} muted />
                <Row label="Partners lent to Ascend, not repaid" value={rm(data.totalAdvancesOutstanding)} muted />
              </dl>
            </div>
            <div className="border-t border-border px-5 py-3">
              <Link href="/admin/money/bank" className="inline-flex items-center gap-1 text-[14px] font-medium text-primary hover:underline">
                The bank <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </Card>
        )}

        {active.map((p) => (
          <Card key={p.partnerId} className={cn('flex flex-col', !p.active && 'opacity-70')}>
            <div className="flex-1 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-[17px] font-semibold truncate">
                    {p.name}
                    {!p.active && <span className="ml-2 text-[12px] font-normal text-text-muted">inactive</span>}
                  </p>
                  <p className="text-[12px] text-text-secondary">Owed now</p>
                </div>
                <span className={cn('shrink-0 whitespace-nowrap font-display text-[24px] leading-8 font-bold tabular-nums', p.owed < 0 && 'text-danger')}>{signedPrice(p.owed)}</span>
              </div>
              <dl className="mt-4 space-y-1.5 border-t border-border pt-3 text-[14px]">
                <Row label="Profit not shared yet" value={rm(p.toShare)} />
                {p.advancesOutstanding > 0 && <Row label="Lent to Ascend, not repaid" value={rm(p.advancesOutstanding)} />}
                {p.capitalOwed > 0 && <Row label="Capital fronted, still due" value={rm(p.capitalOwed)} />}
                <Row label="Earned, all time" value={signedPrice(p.earned)} muted />
                <Row label="Paid out through the system" value={rm(p.paidOut)} muted />
                {p.contributed > 0 && <Row label="Invested in Ascend" value={rm(p.contributed)} muted />}
              </dl>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
              <Link href={`/admin/money/partners/${p.partnerId}`} className="inline-flex items-center gap-1 text-[14px] font-medium text-primary hover:underline">
                History <ArrowRight className="w-4 h-4" />
              </Link>
              <div className="flex gap-1">
                {p.removable && (
                  <Button variant="ghost" size="sm" onClick={() => { setRemoveError(null); setRemoving(p); }}>Remove</Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setRecording(p.partnerId)}>Record</Button>
              </div>
            </div>
          </Card>
        ))}


      </div>

      {empty.length > 0 && (
        <Card>
          <CardHeader title="Nothing recorded" description="Partners with no split, payment or loan. Remove the ones that are mistakes." />
          <ul className="divide-y divide-border">
            {empty.map((p) => (
              <li key={p.partnerId} className="flex items-center justify-between gap-3 px-6 py-2.5">
                <span className="text-[14px]">
                  {p.name}
                  {!p.active && <span className="ml-2 text-[12px] text-text-muted">inactive</span>}
                </span>
                {p.removable ? (
                  <Button variant="ghost" size="sm" onClick={() => { setRemoveError(null); setRemoving(p); }}>Remove</Button>
                ) : (
                  <span className="text-[12px] text-text-muted">in a split rule</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {recording !== undefined && (
        <RecordMoneyDialog
          partners={people}
          defaultPartnerId={recording ?? undefined}
          onClose={() => setRecording(undefined)}
          onSaved={() => { setRecording(undefined); load(); }}
        />
      )}
      {adding && <AddPartnerDialog existing={people} onClose={() => setAdding(false)} onSaved={load} />}
      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.name}?`}
          body="Nothing is recorded against them, so they go without a trace."
          confirmLabel="Remove"
          tone="danger"
          error={removeError}
          onConfirm={async () => {
            if (!token) return false;
            try {
              await adminDeletePartner(token, removing.partnerId);
              load();
            } catch (err) {
              setRemoveError(apiError(err, 'Could not remove.'));
              return false;
            }
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={muted ? 'text-text-secondary' : 'text-text-primary'}>{label}</dt>
      <dd className={cn('tabular-nums whitespace-nowrap', muted ? 'text-text-secondary' : 'font-medium')}>{value}</dd>
    </div>
  );
}

function AddPartnerDialog({ existing, onClose, onSaved }: { existing: PartnerBalance[]; onClose: () => void; onSaved: () => void }) {
  const { token } = useAuth();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (close: () => void) => {
    if (!token || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // The endpoint saves the set; send everyone as they are plus the new one.
      await adminSavePartners(token, [
        ...existing.map((p) => ({ id: p.partnerId, name: p.name, active: p.active })),
        { name: name.trim(), active: true },
      ]);
      onSaved();
      close();
    } catch (err) {
      setError(apiError(err, 'Could not add.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Add a partner"
      description="Someone who takes a share of the profit. Add them to the split on Profit sharing."
      onClose={onClose}
      footer={(close) => (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" form="add-partner-form" size="sm" disabled={busy || !name.trim()}>{busy ? 'Adding…' : 'Add'}</Button>
        </>
      )}
    >
      {(close) => (
        <form id="add-partner-form" onSubmit={(e) => { e.preventDefault(); void save(close); }}>
          <Field label="Name" htmlFor="partner-name">
            <TextInput id="partner-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-autofocus />
          </Field>
          {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        </form>
      )}
    </Dialog>
  );
}
