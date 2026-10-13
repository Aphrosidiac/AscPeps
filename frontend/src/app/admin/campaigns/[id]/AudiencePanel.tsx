'use client';

import { useEffect, useMemo, useState } from 'react';
import { Users, Search, X, UserMinus, UserPlus, Plus } from 'lucide-react';
import { adminAudienceCount, adminCampaignAudience, type CampaignAudienceDetail } from '@/lib/api';
import type { Product } from '@/types';
import { Toggle } from '@/components/admin/ui';
import { cn, formatDate } from '@/lib/utils';
import { AUDIENCE_LABELS } from '../page';

export type Audience = 'ALL' | 'BUYERS' | 'NON_BUYERS' | 'CUSTOMERS';

export interface AudienceSettings {
  audience: Audience;
  excludeOrderedWithinDays: number | null;
  excludeOpenOrders: boolean;
  excludeBoughtProductIds: string[];
  excludeEmails: string[];
}

const AUDIENCE_HINTS: Record<Audience, string> = {
  CUSTOMERS: 'Every subscriber, plus every paid customer who never signed up. Order customers are told in the footer why they got it.',
  ALL: 'Everyone who signed up through the site or at checkout.',
  BUYERS: 'Subscribers with at least one paid order.',
  NON_BUYERS: 'Subscribers who have never completed an order.',
};

// Widest first: the order someone actually reasons in ("everyone… or just…").
const AUDIENCE_ORDER: Audience[] = ['CUSTOMERS', 'ALL', 'BUYERS', 'NON_BUYERS'];

const REASON_LABELS = {
  manual: 'Excluded by you',
  recent: 'Ordered recently',
  open: 'Order on its way',
  bought: 'Already bought',
} as const;

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
const DEFAULT_DAYS = 7;
const PREVIEW_ROWS = 8;

/**
 * Who gets the campaign, in three layers: the base audience, broad rules
 * that take whole groups out, and specific people taken out by hand. The
 * recipient list underneath is the server's own resolution — the same
 * function the send uses — so every number here is the number that goes out.
 */
export function AudiencePanel({
  token,
  campaignId,
  value,
  products,
  refreshKey,
  onChange,
  onCount,
}: {
  token: string | null;
  campaignId: string;
  value: AudienceSettings;
  products: Product[];
  /** Bumped after every save; the panel refetches from the saved rules. */
  refreshKey: number | null;
  onChange: (patch: Partial<AudienceSettings>) => void;
  /** Reports the final recipient count up, for the send button. */
  onCount: (included: number | null, fromOrders: number, excluded: number) => void;
}) {
  const [baseCounts, setBaseCounts] = useState<Partial<Record<Audience, number>>>({});
  const [detail, setDetail] = useState<CampaignAudienceDetail | null>(null);
  const [search, setSearch] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [emailError, setEmailError] = useState('');
  const [productPick, setProductPick] = useState('');

  // Base sizes don't depend on exclusions, so they are fetched once.
  useEffect(() => {
    if (!token) return;
    for (const a of AUDIENCE_ORDER) {
      adminAudienceCount(token, a)
        .then((r) => setBaseCounts((c) => ({ ...c, [a]: r.count })))
        .catch(() => {});
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    adminCampaignAudience(token, campaignId)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        onCount(d.included, d.fromOrders, d.excluded);
      })
      .catch(() => !cancelled && onCount(null, 0, 0));
    return () => {
      cancelled = true;
    };
    // onCount is a setter wrapper from the parent; refetch only on save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, campaignId, refreshKey]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = detail?.rows ?? [];
    return q ? all.filter((r) => r.email.includes(q)) : all;
  }, [detail, search]);
  const visible = showAll || search ? rows : rows.slice(0, PREVIEW_ROWS);

  const excludedEmails = new Set(value.excludeEmails);
  const toggleEmail = (email: string) =>
    onChange({
      excludeEmails: excludedEmails.has(email)
        ? value.excludeEmails.filter((e) => e !== email)
        : [...value.excludeEmails, email],
    });

  const addEmail = () => {
    const e = emailDraft.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setEmailError('That doesn’t look like an email address.');
      return;
    }
    setEmailError('');
    setEmailDraft('');
    if (!excludedEmails.has(e)) onChange({ excludeEmails: [...value.excludeEmails, e] });
  };

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? 'Removed product';
  const reasons = detail?.reasons;

  return (
    <div className="space-y-5">
      {/* ---- 1. Base audience ---- */}
      <div>
        <p className="text-[13px] font-medium text-text-primary mb-2">Send to</p>
        <div className="grid sm:grid-cols-2 gap-2">
          {AUDIENCE_ORDER.map((a) => (
            <label
              key={a}
              className={cn(
                'flex items-start gap-2.5 p-3 rounded-lg border transition-colors cursor-pointer',
                value.audience === a ? 'border-primary bg-primary/5' : 'border-border hover:border-border-hover'
              )}
            >
              <input
                type="radio"
                name="audience"
                checked={value.audience === a}
                onChange={() => onChange({ audience: a })}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{AUDIENCE_LABELS[a]}</span>
                  <span className="text-xs tabular-nums text-text-muted">{baseCounts[a] ?? '…'}</span>
                </span>
                <span className="block text-xs text-text-muted mt-0.5 leading-relaxed">{AUDIENCE_HINTS[a]}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* ---- 2. Broad exclusions ---- */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[13px] font-medium text-text-primary">Exclude groups</p>
          <p className="text-xs text-text-muted">Rules that take whole groups out. Counts are people each rule removes.</p>
        </div>
        <div className="divide-y divide-border">
          <RuleRow count={value.excludeOrderedWithinDays ? reasons?.recent : undefined}>
            <Toggle
              checked={value.excludeOrderedWithinDays !== null}
              onChange={(on) => onChange({ excludeOrderedWithinDays: on ? DEFAULT_DAYS : null })}
              label="Ordered recently"
              description={
                value.excludeOrderedWithinDays !== null ? (
                  <span className="inline-flex items-center gap-1.5">
                    Paid for an order in the last
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={value.excludeOrderedWithinDays}
                      onChange={(e) => {
                        const n = Math.max(1, Math.min(365, Number(e.target.value) || 1));
                        onChange({ excludeOrderedWithinDays: n });
                      }}
                      className="w-14 px-1.5 py-0.5 rounded border border-border bg-surface text-xs text-center"
                    />
                    days
                  </span>
                ) : (
                  'They just bought. Skip them for this one.'
                )
              }
            />
          </RuleRow>
          <RuleRow count={value.excludeOpenOrders ? reasons?.open : undefined}>
            <Toggle
              checked={value.excludeOpenOrders}
              onChange={(on) => onChange({ excludeOpenOrders: on })}
              label="Order still on its way"
              description="Paid, not yet delivered. “Buy now” before their parcel lands reads as pushy."
            />
          </RuleRow>
          <RuleRow count={value.excludeBoughtProductIds.length ? reasons?.bought : undefined}>
            <div className="min-w-0">
              <p className="text-[15px] leading-[22px] text-text-primary">Already bought</p>
              <p className="text-[13px] leading-[18px] text-text-secondary">
                Anyone with a paid order containing any of these.
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {value.excludeBoughtProductIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-surface-elevated px-2.5 py-1 text-xs">
                    {productName(id)}
                    <button
                      type="button"
                      aria-label={`Stop excluding buyers of ${productName(id)}`}
                      onClick={() =>
                        onChange({ excludeBoughtProductIds: value.excludeBoughtProductIds.filter((x) => x !== id) })
                      }
                      className="text-text-muted hover:text-text-primary cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <select
                  value={productPick}
                  onChange={(e) => {
                    const id = e.target.value;
                    setProductPick('');
                    if (id && !value.excludeBoughtProductIds.includes(id)) {
                      onChange({ excludeBoughtProductIds: [...value.excludeBoughtProductIds, id] });
                    }
                  }}
                  className="rounded-full border border-dashed border-border bg-surface px-2.5 py-1 text-xs text-text-secondary cursor-pointer"
                >
                  <option value="">+ Add product</option>
                  {products
                    .filter((p) => !value.excludeBoughtProductIds.includes(p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </RuleRow>
        </div>
      </div>

      {/* ---- 3. Specific exclusions ---- */}
      <div className="rounded-lg border border-border">
        <div className="px-4 py-3 border-b border-border flex items-baseline justify-between gap-2">
          <div>
            <p className="text-[13px] font-medium text-text-primary">Exclude specific people</p>
            <p className="text-xs text-text-muted">Type an address, or use Exclude in the list below.</p>
          </div>
          {reasons && reasons.manual > 0 && <span className="text-xs text-text-muted tabular-nums">−{reasons.manual}</span>}
        </div>
        <div className="p-4 space-y-2">
          <div className="flex gap-2">
            <input
              type="email"
              value={emailDraft}
              onChange={(e) => {
                setEmailDraft(e.target.value);
                setEmailError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addEmail();
                }
              }}
              placeholder="name@example.com"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <button
              type="button"
              onClick={addEmail}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm hover:bg-surface-elevated cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Exclude
            </button>
          </div>
          {emailError && <p className="text-xs text-danger">{emailError}</p>}
          {value.excludeEmails.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {value.excludeEmails.map((e) => (
                <span key={e} className="inline-flex items-center gap-1 rounded-full bg-surface-elevated px-2.5 py-1 text-xs">
                  {e}
                  <button
                    type="button"
                    aria-label={`Include ${e} again`}
                    onClick={() => toggleEmail(e)}
                    className="text-text-muted hover:text-text-primary cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---- 4. Result ---- */}
      <div className="rounded-lg bg-surface-elevated/60 border border-border">
        <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-xs text-text-muted uppercase tracking-wider">Will receive it</p>
            <p className="font-display text-2xl font-bold tabular-nums">{detail ? people(detail.included) : '…'}</p>
          </div>
          {detail && (
            <p className="text-xs text-text-secondary text-right leading-relaxed">
              {detail.subscribers} subscribers · {detail.fromOrders} order customers
              <br />
              <span className="text-text-muted">
                {detail.total} in audience · {detail.excluded} excluded
              </span>
            </p>
          )}
        </div>

        <div className="border-t border-border px-4 py-3">
          <div className="relative mb-2">
            <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search recipients"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {visible.map((r) => (
              <li key={r.email} className={cn('flex items-center gap-3 px-3 py-2', r.excluded && 'bg-surface-elevated/50')}>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm truncate', r.excluded && 'line-through text-text-muted')}>{r.email}</p>
                  <p className="text-xs text-text-muted">
                    {r.kind === 'ORDER' ? 'Order customer' : 'Subscriber'}
                    {r.paidOrders > 0
                      ? ` · ${r.paidOrders} order${r.paidOrders === 1 ? '' : 's'} · last ${formatDate(r.lastPaidAt!)}`
                      : ' · no orders'}
                    {r.excluded && <span className="text-amber-700"> · {REASON_LABELS[r.excluded]}</span>}
                  </p>
                </div>
                {(!r.excluded || r.excluded === 'manual') && (
                  <button
                    type="button"
                    onClick={() => toggleEmail(r.email)}
                    className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary cursor-pointer shrink-0"
                  >
                    {r.excluded ? (
                      <>
                        <UserPlus className="w-3.5 h-3.5" /> Include
                      </>
                    ) : (
                      <>
                        <UserMinus className="w-3.5 h-3.5" /> Exclude
                      </>
                    )}
                  </button>
                )}
              </li>
            ))}
            {detail && rows.length === 0 && (
              <li className="px-3 py-3 text-sm text-text-muted flex items-center gap-2">
                <Users className="w-4 h-4" /> {search ? 'Nobody matches.' : 'This audience has nobody in it.'}
              </li>
            )}
            {!detail && <li className="px-3 py-3 text-sm text-text-muted">Loading recipients…</li>}
          </ul>
          {!search && rows.length > PREVIEW_ROWS && (
            <button
              type="button"
              onClick={() => setShowAll((s) => !s)}
              className="mt-2 text-xs text-text-secondary hover:text-text-primary underline underline-offset-2 cursor-pointer"
            >
              {showAll ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RuleRow({ count, children }: { count?: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">{children}</div>
      {count !== undefined && (
        <span className="mt-1 shrink-0 rounded-full bg-amber-50 text-amber-800 px-2 py-0.5 text-xs tabular-nums">−{count}</span>
      )}
    </div>
  );
}
