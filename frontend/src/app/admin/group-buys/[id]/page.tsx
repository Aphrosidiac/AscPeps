'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Copy, ExternalLink, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminDeleteGroupBuy, adminDuplicateGroupBuy, adminGetGroupBuy, adminUpdateGroupBuy, errorText, type AdminGroupBuy,
} from '@/lib/group-buy-api';
import { Button } from '@/components/ui/Button';
import { PageHeader, SaveBar, TabBar } from '@/components/admin/ui';
import { ConfirmDialog } from '@/components/admin/Dialog';
import { PhaseBadge } from '../shared';
import { OverviewTab } from './OverviewTab';
import { SetupTab } from './SetupTab';
import { ItemsTab } from './ItemsTab';
import { PromoTab } from './PromoTab';
import { RewardTab } from './RewardTab';
import { TimelineTab } from './TimelineTab';
import { OrdersTab } from './OrdersTab';
import { SignupsTab } from './SignupsTab';

type Tab = 'overview' | 'setup' | 'items' | 'promo' | 'reward' | 'timeline' | 'orders' | 'signups';

// The batch fields the Setup, Promotion and Reward tabs edit together and
// save with one PATCH. Items and the timeline save on their own tabs.
const DRAFT_KEYS = [
  'title', 'slug', 'tagline', 'description', 'heroImageUrl', 'published', 'opensAt', 'closesAt', 'shipEstimate',
  'minOrderAmount', 'maxUnitsPerOrder', 'shippingFee', 'allowWhatsapp', 'joinedMode', 'joinedBoost', 'joinedFixed', 'joinedLabel',
  'bannerEnabled', 'bannerText', 'bannerCta', 'bannerStartsAt', 'bannerEndsAt', 'bannerTone',
  'popupEnabled', 'popupTitle', 'popupBody', 'popupImageUrl', 'popupCta', 'popupStartsAt', 'popupEndsAt', 'popupDelaySec', 'popupFrequency', 'popupPages',
  'homeEnabled', 'homeTitle', 'homeBody', 'homeImageUrl', 'homeCta',
  'rewardEnabled', 'rewardType', 'rewardValue', 'rewardScope', 'rewardMinOrder', 'rewardValidDays', 'rewardMembersOnly', 'rewardHeadline',
  'notifyStageEmails',
] as const;

export type Draft = Pick<AdminGroupBuy, (typeof DRAFT_KEYS)[number]>;
export type SetDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => void;

function draftOf(gb: AdminGroupBuy): Draft {
  return Object.fromEntries(DRAFT_KEYS.map((k) => [k, gb[k]])) as Draft;
}

export default function AdminGroupBuyPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { token } = useAuth();
  const [gb, setGb] = useState<AdminGroupBuy | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loadError, setLoadError] = useState('');

  const accept = useCallback((next: AdminGroupBuy) => {
    setGb(next);
    setDraft(draftOf(next));
  }, []);

  const load = useCallback(() => {
    if (!token || !id) return;
    adminGetGroupBuy(token, id).then(accept).catch((e) => setLoadError(errorText(e, 'Could not load this batch.')));
  }, [token, id, accept]);
  useEffect(load, [load]);

  const dirty = useMemo(() => !!gb && !!draft && JSON.stringify(draftOf(gb)) !== JSON.stringify(draft), [gb, draft]);
  const set: SetDraft = useCallback((key, value) => setDraft((d) => (d ? { ...d, [key]: value } : d)), []);

  // Leaving with unsaved settings asks first.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = async (patch?: Partial<Draft>) => {
    if (!token || !gb || !draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const body = patch ?? Object.fromEntries(DRAFT_KEYS.filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(gb[k])).map((k) => [k, draft[k]]));
      const next = await adminUpdateGroupBuy(token, gb.id, body as Partial<AdminGroupBuy>);
      // Keep edits on other fields when only a switch (publish) was saved.
      setGb(next);
      setDraft((d) => (patch && d ? { ...d, ...patch } : draftOf(next)));
      setMessage({ tone: 'ok', text: 'Saved' });
    } catch (e) {
      setMessage({ tone: 'err', text: errorText(e, 'Could not save.') });
    } finally {
      setSaving(false);
    }
  };

  const duplicate = async () => {
    if (!token || !gb) return;
    try {
      const copy = await adminDuplicateGroupBuy(token, gb.id);
      router.push(`/admin/group-buys/${copy.id}`);
    } catch (e) {
      setMessage({ tone: 'err', text: errorText(e) });
    }
  };

  if (loadError) return <p className="text-sm text-danger">{loadError}</p>;
  if (!gb || !draft) return <div className="h-64 rounded-[10px] bg-surface-elevated animate-pulse" />;

  const tabs: { id: Tab; label: string; dot?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'setup', label: 'Setup', dot: dirty },
    { id: 'items', label: 'Products & prices' },
    { id: 'promo', label: 'Promotion' },
    { id: 'reward', label: 'Sign-up reward' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'orders', label: `Orders (${gb.stats.orders})` },
    { id: 'signups', label: `Sign-ups (${gb.stats.signups})` },
  ];
  const usesDraft = tab === 'setup' || tab === 'promo' || tab === 'reward';

  return (
    <div className="pb-6">
      <PageHeader
        back="/admin/group-buys"
        title={<span className="flex min-w-0 items-center gap-2"><span className="truncate">{gb.title}</span><PhaseBadge phase={gb.phase} /></span>}
        subtitle={`${gb.label} · /group-buy/${gb.slug}`}
        actions={
          <>
            <a href={`/group-buy/${gb.slug}`} target="_blank" rel="noopener noreferrer">
              <Button variant="secondary" size="sm"><ExternalLink className="w-4 h-4" /> {gb.published ? 'View' : 'Preview'}</Button>
            </a>
            <Button variant="secondary" size="sm" onClick={duplicate}><Copy className="w-4 h-4" /> Duplicate</Button>
            {gb.stats.orders === 0 && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} aria-label="Delete batch"><Trash2 className="w-4 h-4" /></Button>
            )}
            <Button size="sm" onClick={() => save({ published: !gb.published })} disabled={saving}>
              {gb.published ? 'Unpublish' : 'Publish'}
            </Button>
          </>
        }
      />

      <TabBar tabs={tabs} current={tab} onSelect={setTab} className="mb-6" />

      {message && !usesDraft && (
        <p className={message.tone === 'ok' ? 'mb-4 text-sm text-success' : 'mb-4 text-sm text-danger'}>{message.text}</p>
      )}

      {tab === 'overview' && <OverviewTab gb={gb} onGo={(t) => setTab(t as Tab)} />}
      {tab === 'setup' && <SetupTab draft={draft} set={set} />}
      {tab === 'items' && token && <ItemsTab gb={gb} token={token} onSaved={accept} />}
      {tab === 'promo' && token && <PromoTab draft={draft} set={set} token={token} />}
      {tab === 'reward' && token && <RewardTab draft={draft} set={set} gb={gb} token={token} />}
      {tab === 'timeline' && token && <TimelineTab gb={gb} token={token} onSaved={accept} notify={draft.notifyStageEmails} setNotify={(v) => save({ notifyStageEmails: v })} />}
      {tab === 'orders' && token && <OrdersTab gb={gb} token={token} />}
      {tab === 'signups' && token && <SignupsTab gb={gb} token={token} />}

      {usesDraft && (
        <SaveBar className="mt-6">
          <Button onClick={() => save()} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
          <Button variant="ghost" onClick={() => setDraft(draftOf(gb))} disabled={!dirty || saving}>Discard</Button>
          {message ? (
            <span className={message.tone === 'ok' ? 'text-sm text-success' : 'text-sm text-danger'}>{message.text}</span>
          ) : (
            <span className="text-sm text-text-secondary">{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span>
          )}
        </SaveBar>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this batch?"
          body="It has no orders. Its sign-ups and their reward codes go with it."
          confirmLabel="Delete batch"
          tone="danger"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            if (!token) return;
            await adminDeleteGroupBuy(token, gb.id);
            router.push('/admin/group-buys');
          }}
        />
      )}
    </div>
  );
}
