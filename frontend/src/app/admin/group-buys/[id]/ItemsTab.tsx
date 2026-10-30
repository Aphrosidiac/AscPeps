'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Search, Trash2, X } from 'lucide-react';
import {
  adminGroupBuyVariants, adminSetGroupBuyItems, errorText,
  type AdminGroupBuy, type AdminGroupBuyItem, type AdminVariantOption,
} from '@/lib/group-buy-api';
import { formatPrice, cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, Field, SaveBar, SelectInput, TextInput, Toggle } from '@/components/admin/ui';
import { Dialog } from '@/components/admin/Dialog';
import { IntInput, MoneyInput, nullIfEmpty } from '../shared';

/**
 * The batch's products and their wholesale tiers. A tier reads "from N units,
 * each costs RM X"; the customer's own quantity of that product picks it.
 * Prices are per sell unit — a vial, or a kit of N vials.
 */
export function ItemsTab({ gb, token, onSaved }: { gb: AdminGroupBuy; token: string; onSaved: (gb: AdminGroupBuy) => void }) {
  const [items, setItems] = useState<AdminGroupBuyItem[]>(gb.items);
  const [variants, setVariants] = useState<AdminVariantOption[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => { adminGroupBuyVariants(token).then(setVariants).catch(() => {}); }, [token]);
  useEffect(() => { setItems(gb.items); }, [gb.items]);

  const dirty = JSON.stringify(strip(items)) !== JSON.stringify(strip(gb.items));
  const update = (i: number, patch: Partial<AdminGroupBuyItem>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: -1 | 1) => setItems((list) => {
    const next = [...list];
    const [row] = next.splice(i, 1);
    next.splice(i + d, 0, row);
    return next;
  });

  const add = (v: AdminVariantOption) => {
    setItems((list) => [...list, {
      variantId: v.id, sellUnit: 'VIAL', packSize: 10, unitLabel: null, minQty: null, maxQty: null, minAmount: null, note: null, active: true,
      tiers: [{ minQty: 1, price: v.storePrice }],
      variant: { name: v.name, code: v.code, size: v.size, imageUrl: v.imageUrl, active: true, storePrice: v.storePrice },
    }]);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const next = await adminSetGroupBuyItems(token, gb.id, strip(items));
      onSaved(next);
      setMessage({ tone: 'ok', text: 'Products and prices saved' });
    } catch (e) {
      setMessage({ tone: 'err', text: errorText(e, 'Could not save.') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {items.length === 0 && (
        <div className="rounded-[10px] border border-dashed border-border bg-surface px-6 py-10 text-center">
          <p className="text-[15px] font-medium text-text-primary">No products in this batch yet</p>
          <p className="mt-1 text-[13px] text-text-secondary">Add the sizes you want to offer, then set their tier prices.</p>
        </div>
      )}

      {items.map((it, i) => (
        <ItemCard
          key={it.variantId}
          item={it}
          first={i === 0}
          last={i === items.length - 1}
          onChange={(p) => update(i, p)}
          onMove={(d) => move(i, d)}
          onRemove={() => setItems((list) => list.filter((_, j) => j !== i))}
        />
      ))}

      <Button variant="secondary" onClick={() => setPicking(true)}><Plus className="w-4 h-4" /> Add products</Button>

      <SaveBar>
        <Button onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save products & prices'}</Button>
        <Button variant="ghost" onClick={() => setItems(gb.items)} disabled={!dirty || saving}>Discard</Button>
        {message ? (
          <span className={message.tone === 'ok' ? 'text-sm text-success' : 'text-sm text-danger'}>{message.text}</span>
        ) : (
          <span className="text-sm text-text-secondary">{dirty ? 'Unsaved changes' : `${items.length} product${items.length === 1 ? '' : 's'}`}</span>
        )}
      </SaveBar>

      {picking && (
        <PickerDialog
          variants={variants}
          taken={new Set(items.map((i) => i.variantId))}
          onPick={add}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

function strip(items: AdminGroupBuyItem[]): AdminGroupBuyItem[] {
  return items.map(({ variantId, sellUnit, packSize, unitLabel, minQty, maxQty, minAmount, note, active, tiers }) => ({
    variantId, sellUnit, packSize, unitLabel, minQty, maxQty, minAmount, note, active,
    tiers: [...tiers].sort((a, b) => a.minQty - b.minQty),
  }));
}

function ItemCard({ item, first, last, onChange, onMove, onRemove }: {
  item: AdminGroupBuyItem; first: boolean; last: boolean;
  onChange: (p: Partial<AdminGroupBuyItem>) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const kit = item.sellUnit === 'KIT';
  const perVial = kit ? Math.max(item.packSize, 1) : 1;
  const unit = item.unitLabel?.trim() || (kit ? 'kit' : 'vial');
  const store = item.variant?.storePrice ?? 0;
  // Rows stay in the order typed (so a row never jumps mid-edit); the save sorts them.
  const tiers = item.tiers;
  const sorted = useMemo(() => [...item.tiers].sort((a, b) => a.minQty - b.minQty), [item.tiers]);

  const setTier = (idx: number, patch: Partial<{ minQty: number; price: number }>) => {
    const next = [...tiers];
    next[idx] = { ...next[idx], ...patch };
    onChange({ tiers: next });
  };
  const addTier = () => {
    const lastT = sorted[sorted.length - 1];
    const minQty = lastT ? (lastT.minQty < 10 ? 10 : lastT.minQty * 5) : 1;
    const price = lastT ? Math.round((lastT.price * 0.9) / (kit ? perVial : 1)) * (kit ? perVial : 1) : store * perVial;
    onChange({ tiers: [...tiers, { minQty, price }] });
  };

  return (
    <Card className={cn(!item.active && 'opacity-70')}>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="font-display text-[13px] font-semibold text-text-secondary">{item.variant?.code}</span>
            {item.variant?.name}
            {item.variant && !item.variant.active && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[12px] font-medium text-amber-800">Not sold in store</span>}
          </span>
        }
        description={`Store price ${formatPrice(store)} per vial`}
        actions={
          <>
            <button type="button" aria-label="Move up" disabled={first} onClick={() => onMove(-1)} className="flex h-8 w-8 items-center justify-center rounded-[6px] text-text-secondary hover:bg-surface-elevated disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
            <button type="button" aria-label="Move down" disabled={last} onClick={() => onMove(1)} className="flex h-8 w-8 items-center justify-center rounded-[6px] text-text-secondary hover:bg-surface-elevated disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
            <button type="button" aria-label="Remove from batch" onClick={onRemove} className="flex h-8 w-8 items-center justify-center rounded-[6px] text-text-secondary hover:bg-surface-elevated hover:text-danger"><Trash2 className="h-4 w-4" /></button>
          </>
        }
      />
      <CardBody className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Sold by">
              <SelectInput value={item.sellUnit} onChange={(e) => onChange({ sellUnit: e.target.value as 'VIAL' | 'KIT' })}>
                <option value="VIAL">The vial</option>
                <option value="KIT">The kit</option>
              </SelectInput>
            </Field>
            {kit ? (
              <Field label="Vials per kit">
                <IntInput min={2} value={item.packSize} onChange={(v) => onChange({ packSize: v ?? 10 })} suffix="vials" />
              </Field>
            ) : <div />}
          </div>
          <Field label="Unit name" help={`Optional — e.g. “box”. Default “${kit ? 'kit' : 'vial'}”.`}>
            <TextInput value={item.unitLabel ?? ''} onChange={(e) => onChange({ unitLabel: nullIfEmpty(e.target.value) })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Minimum" help={unit + 's'}>
              <IntInput min={1} value={item.minQty} placeholder="—" onChange={(v) => onChange({ minQty: v })} />
            </Field>
            <Field label="Most" help={unit + 's'}>
              <IntInput min={1} value={item.maxQty} placeholder="—" onChange={(v) => onChange({ maxQty: v })} />
            </Field>
            <Field label="Min. spend" help="this product">
              <MoneyInput value={item.minAmount} placeholder="—" onChange={(v) => onChange({ minAmount: v })} />
            </Field>
          </div>
          <Field label="Note" help="Shown under the product, e.g. “Includes 10 × 3mL BAC water”.">
            <TextInput value={item.note ?? ''} onChange={(e) => onChange({ note: nullIfEmpty(e.target.value) })} />
          </Field>
          <Toggle checked={item.active} onChange={(v) => onChange({ active: v })} label="Offered in this batch" description="Off hides it without losing its prices." />
        </div>

        <div>
          <p className="mb-2 text-[14px] font-medium text-text-primary">Price tiers <span className="font-normal text-text-secondary">· per {unit}</span></p>
          <div className="overflow-hidden rounded-[8px] border border-border">
            <table className="w-full text-[14px]">
              <thead className="bg-surface-elevated text-left text-[12px] text-text-secondary">
                <tr><th className="px-3 py-2 font-medium">From</th><th className="px-3 py-2 font-medium">Price each</th><th className="px-3 py-2 font-medium">Per vial</th><th className="w-8" /></tr>
              </thead>
              <tbody>
                {tiers.map((t, idx) => {
                  const vial = t.price / perVial;
                  const off = store > 0 ? Math.round((1 - vial / store) * 100) : 0;
                  const uneven = kit && t.price % perVial !== 0;
                  const next = sorted.find((x) => x.minQty > t.minQty);
                  return (
                    <tr key={idx} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <IntInput min={1} value={t.minQty} onChange={(v) => setTier(idx, { minQty: v ?? 1 })} suffix={unit + 's'} />
                        <p className="mt-1 text-[12px] text-text-secondary">{next ? `${t.minQty}–${next.minQty - 1}` : `${t.minQty}+`}</p>
                      </td>
                      <td className="px-3 py-2">
                        <MoneyInput value={t.price} onChange={(v) => setTier(idx, { price: v ?? 0 })} />
                        {uneven && <p className="mt-1 text-[12px] text-danger">Must split evenly into {perVial} vials</p>}
                      </td>
                      <td className="px-3 py-2 pt-4 tabular-nums">
                        {formatPrice(Math.round(vial))}
                        {off > 0 && <span className="ml-1.5 text-[12px] text-success">−{off}%</span>}
                      </td>
                      <td className="pr-2 pt-3.5">
                        <button type="button" aria-label="Remove tier" onClick={() => onChange({ tiers: tiers.filter((_, j) => j !== idx) })} className="flex h-7 w-7 items-center justify-center rounded text-text-secondary hover:bg-surface-elevated hover:text-danger"><X className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={addTier} className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"><Plus className="h-3.5 w-3.5" /> Add a tier</button>
          {sorted.length > 0 && sorted[0].minQty > 1 && (
            <p className="mt-2 text-[13px] text-text-secondary">The first tier starts at {sorted[0].minQty}, so that is also the least anyone can order.</p>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function PickerDialog({ variants, taken, onPick, onClose }: { variants: AdminVariantOption[]; taken: Set<string>; onPick: (v: AdminVariantOption) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [added, setAdded] = useState<Set<string>>(new Set());
  const list = variants.filter((v) => !q || `${v.code} ${v.name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog title="Add products" description="Pick the sizes this batch sells. Set their prices after." onClose={onClose} size="md"
      footer={(close) => <Button size="sm" onClick={close}>Done</Button>}
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <TextInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or code" className="pl-9" />
      </div>
      <div className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-[8px] border border-border">
        {list.map((v) => {
          const isIn = taken.has(v.id) || added.has(v.id);
          return (
            <button
              key={v.id}
              type="button"
              disabled={isIn}
              onClick={() => { onPick(v); setAdded((s) => new Set(s).add(v.id)); }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-elevated disabled:cursor-default disabled:opacity-60"
            >
              <span className="min-w-0">
                <span className="mr-2 font-display text-[13px] font-semibold text-text-secondary">{v.code}</span>
                <span className="text-[14px] text-text-primary">{v.name}</span>
              </span>
              <span className="shrink-0 text-[13px] text-text-secondary">{isIn ? 'Added' : `${formatPrice(v.storePrice)} · ${v.stock} in stock`}</span>
            </button>
          );
        })}
        {list.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-text-secondary">Nothing matches.</p>}
      </div>
    </Dialog>
  );
}
