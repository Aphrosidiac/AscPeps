'use client';

import { useEffect, useState } from 'react';
import { Check, Circle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGroupBuySupplierSheet, type AdminGroupBuy, type SupplierSheetRow } from '@/lib/group-buy-api';
import { formatPrice, cn } from '@/lib/utils';
import { Card, CardBody, CardHeader } from '@/components/admin/ui';
import { shortDateTime } from '../shared';

/**
 * The batch at a glance: how it is selling, what is switched on, and the
 * supplier sheet — vials per size to order once it closes.
 */
export function OverviewTab({ gb, onGo }: { gb: AdminGroupBuy; onGo: (tab: string) => void }) {
  const [sheet, setSheet] = useState<SupplierSheetRow[] | null>(null);
  const { token } = useAuth();
  useEffect(() => { if (token) adminGroupBuySupplierSheet(token, gb.id).then(setSheet).catch(() => setSheet([])); }, [token, gb.id]);

  const priced = gb.items.filter((i) => i.active && i.tiers.length > 0).length;
  const checks: { ok: boolean; label: string; tab: string }[] = [
    { ok: priced > 0, label: priced > 0 ? `${priced} product${priced === 1 ? '' : 's'} priced` : 'Add products and prices', tab: 'items' },
    { ok: new Date(gb.closesAt) > new Date(gb.opensAt), label: `Runs ${shortDateTime(gb.opensAt)} → ${shortDateTime(gb.closesAt)}`, tab: 'setup' },
    { ok: gb.published, label: gb.published ? 'Published' : 'Not published — customers cannot see it', tab: 'overview' },
    { ok: gb.bannerEnabled, label: gb.bannerEnabled ? 'Banner on' : 'Banner off', tab: 'promo' },
    { ok: gb.popupEnabled, label: gb.popupEnabled ? 'Popup on' : 'Popup off', tab: 'promo' },
    { ok: gb.homeEnabled, label: gb.homeEnabled ? 'Home section on' : 'Home section off', tab: 'promo' },
    { ok: gb.rewardEnabled && gb.rewardValue > 0, label: gb.rewardEnabled && gb.rewardValue > 0 ? `Sign-up reward: ${gb.rewardType === 'PERCENTAGE' ? `${gb.rewardValue}%` : formatPrice(gb.rewardValue)} off` : 'No sign-up reward', tab: 'reward' },
    { ok: gb.joinedMode !== 'OFF', label: gb.joinedMode === 'OFF' ? 'Joined counter off' : `Joined counter shows ${gb.joinedShown}`, tab: 'setup' },
  ];
  const stage = gb.stages.find((s) => s.key === gb.stageKey);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Panel label="Revenue (paid)" value={formatPrice(gb.stats.revenue)} />
        <Panel label="Paid orders" value={String(gb.stats.paidOrders)} sub={gb.stats.unpaidOrders ? `${gb.stats.unpaidOrders} waiting for payment` : undefined} />
        <Panel label="Buyers" value={String(gb.stats.buyers)} />
        <Panel label="Sign-ups" value={String(gb.stats.signups)} sub={gb.stats.signups ? `${Math.round((gb.stats.buyers / gb.stats.signups) * 100)}% have bought` : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <Card className="h-fit">
          <CardHeader title="Set-up" description={`Timeline: ${stage?.label ?? gb.stageKey}`} />
          <CardBody className="space-y-1 p-3 sm:p-3">
            {checks.map((c) => (
              <button key={c.label} type="button" onClick={() => onGo(c.tab)} className="flex w-full items-center gap-2.5 rounded-[6px] px-3 py-2 text-left text-[14px] hover:bg-surface-elevated">
                {c.ok ? <Check className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-text-muted" />}
                <span className={cn(c.ok ? 'text-text-primary' : 'text-text-secondary')}>{c.label}</span>
              </button>
            ))}
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader title="Supplier sheet" description="Vials per size across the batch. Order the paid column once it closes." />
          {sheet === null ? (
            <div className="m-5 h-24 rounded bg-surface-elevated animate-pulse" />
          ) : sheet.length === 0 ? (
            <p className="px-6 py-6 text-[13px] text-text-secondary">Nothing ordered yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead className="text-left text-[12px] text-text-secondary"><tr className="border-b border-border"><th className="px-6 py-2 font-medium">Size</th><th className="px-3 py-2 text-right font-medium">Paid</th><th className="px-3 py-2 text-right font-medium">Unpaid</th><th className="px-6 py-2 text-right font-medium">In store</th></tr></thead>
                <tbody>
                  {sheet.map((r) => (
                    <tr key={r.variantId} className="border-b border-border last:border-0">
                      <td className="px-6 py-2.5"><span className="mr-2 font-display text-[13px] font-semibold text-text-secondary">{r.code}</span>{r.name}</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{r.paidVials}{r.packSize ? <span className="ml-1 text-[12px] font-normal text-text-secondary">({r.paidVials / r.packSize} kits)</span> : null}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-text-secondary">{r.unpaidVials || '—'}</td>
                      <td className="px-6 py-2.5 text-right tabular-nums text-text-secondary">{r.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Panel({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="px-5 py-4">
      <p className="text-[13px] text-text-secondary">{label}</p>
      <p className="mt-1 font-display text-[22px] font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[12px] text-text-secondary">{sub}</p>}
    </Card>
  );
}
