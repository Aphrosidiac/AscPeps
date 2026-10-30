'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Users2, Megaphone, PanelTop, Home, Gift } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminCreateGroupBuy, adminListGroupBuys, errorText, type AdminGroupBuyRow } from '@/lib/group-buy-api';
import { formatPrice, cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/admin/ui';
import { PhaseBadge, shortDateTime } from './shared';

export default function AdminGroupBuysPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<AdminGroupBuyRow[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    adminListGroupBuys(token).then(setRows).catch((e) => setError(errorText(e, 'Could not load the batches.')));
  }, [token]);
  useEffect(load, [load]);

  // Creates a real draft straight away and opens it, like Campaigns: a batch
  // takes several sittings to set up and should never live only in a modal.
  const create = async () => {
    if (!token) return;
    setCreating(true);
    try {
      const gb = await adminCreateGroupBuy(token);
      router.push(`/admin/group-buys/${gb.id}`);
    } catch (e) {
      setError(errorText(e));
      setCreating(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Group Buys"
        subtitle="Time-boxed batches with their own wholesale prices, promotion and timeline"
        actions={<Button onClick={create} disabled={creating}><Plus className="w-4 h-4" /> New batch</Button>}
      />
      {error && <p className="mb-4 text-sm text-danger">{error}</p>}

      {rows === null ? (
        <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-24 rounded-[10px] bg-surface-elevated animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-[10px] border border-border bg-surface px-6 py-14 text-center">
          <Users2 className="mx-auto mb-3 h-9 w-9 text-text-muted" />
          <p className="text-[15px] font-medium text-text-primary">No batches yet</p>
          <p className="mt-1 text-[13px] text-text-secondary">Start one with New batch — it stays a draft until you publish it.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
          {rows.map((r, i) => (
            <Link
              key={r.id}
              href={`/admin/group-buys/${r.id}`}
              className={cn('grid gap-3 px-5 py-4 hover:bg-surface-elevated/60 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:items-center', i > 0 && 'border-t border-border')}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-[13px] font-semibold text-text-secondary">{r.label}</span>
                  <PhaseBadge phase={r.phase} />
                  {r.phase === 'CLOSED' && <span className="text-[12px] text-text-secondary">· {r.stageLabel}</span>}
                </div>
                <p className="mt-0.5 truncate text-[15px] font-medium text-text-primary">{r.title}</p>
                <p className="text-[13px] text-text-secondary">{shortDateTime(r.opensAt)} → {shortDateTime(r.closesAt)} · {r.itemCount} product{r.itemCount === 1 ? '' : 's'}</p>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                <Figure label="Paid orders" value={String(r.paidOrders)} sub={r.unpaidOrders ? `${r.unpaidOrders} unpaid` : undefined} />
                <Figure label="Revenue" value={formatPrice(r.revenue)} />
                <Figure label="Sign-ups" value={String(r.signups)} />
              </div>
              <div className="flex flex-wrap gap-1.5 md:justify-end">
                <PromoPill on={r.promo.banner} icon={PanelTop} label="Banner" />
                <PromoPill on={r.promo.popup} icon={Megaphone} label="Popup" />
                <PromoPill on={r.promo.home} icon={Home} label="Home" />
                <PromoPill on={r.promo.reward} icon={Gift} label="Reward" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-text-secondary">{label}</p>
      <p className="font-medium tabular-nums text-text-primary">{value}{sub && <span className="ml-1.5 text-[12px] font-normal text-text-secondary">{sub}</span>}</p>
    </div>
  );
}

function PromoPill({ on, icon: Icon, label }: { on: boolean; icon: typeof Megaphone; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px]', on ? 'border-text-primary/20 bg-surface-elevated text-text-primary' : 'border-border text-text-muted')}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </span>
  );
}
