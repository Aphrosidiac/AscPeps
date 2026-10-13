'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Send, TestTube2, Trash2, Users, Check, AlertTriangle, Loader2,
  ArrowUp, ArrowDown, X, Plus, Search, Monitor, Smartphone,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminGetCampaign,
  adminUpdateCampaign,
  adminDeleteCampaign,
  adminSendTestCampaign,
  adminSendCampaign,
  adminAudienceCount,
  adminPreviewCampaign,
  adminGetProducts,
} from '@/lib/api';
import type { Product } from '@/types';
import { formatDate, cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Animate } from '@/components/ui/Animate';
import { PageHeader } from '@/components/admin/ui';
import { EmailPreview, InboxRow } from '@/components/admin/EmailPreview';
import { AUDIENCE_LABELS } from '../page';

type Audience = 'ALL' | 'BUYERS' | 'NON_BUYERS' | 'CUSTOMERS';

interface Campaign {
  id: string;
  name: string;
  subject: string;
  preheader: string | null;
  headline: string | null;
  subhead: string | null;
  badge: string | null;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  productIds: string[];
  audience: Audience;
  status: 'DRAFT' | 'SENDING' | 'SENT';
  recipientCount: number;
  sentAt: string | null;
  delivery: Record<string, number>;
}

const AUDIENCE_HINTS: Record<Audience, string> = {
  ALL: 'Everyone currently subscribed.',
  BUYERS: 'Subscribers whose address is on at least one paid order.',
  NON_BUYERS: 'Subscribers who have never completed an order — the follow-up cut.',
  CUSTOMERS:
    'Every subscriber, plus every paid customer who never signed up. Anyone who unsubscribed stays out, and the footer tells order customers why they got it.',
};

// From the cold-email study the plan was built on: subjects under 30
// characters opened best, bodies under 100 words got replies. Shown as
// guidance next to the field, never enforced.
const SUBJECT_TARGET = 30;
const BODY_TARGET = 100;

const MAX_PRODUCTS = 7;

const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

function stockOf(p: Product): number {
  return (p.variants ?? []).filter((v) => v.active).reduce((n, v) => n + Math.max(0, v.stock), 0);
}

function fromPrice(p: Product): string {
  const prices = (p.variants ?? []).filter((v) => v.active).map((v) => v.price);
  return prices.length ? `RM ${Math.min(...prices) / 100}` : '—';
}

export default function AdminCampaignDetailPage() {
  const { token } = useAuth();
  const router = useRouter();
  const id = useParams().id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [audienceCount, setAudienceCount] = useState<number | null>(null);
  const [testEmail, setTestEmail] = useState('');
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [confirmSend, setConfirmSend] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [sendError, setSendError] = useState('');

  const [form, setForm] = useState({
    name: '',
    subject: '',
    preheader: '',
    headline: '',
    subhead: '',
    badge: '',
    body: '',
    ctaLabel: '',
    ctaUrl: '',
    productIds: [] as string[],
    audience: 'ALL' as Audience,
  });
  const [fromOrders, setFromOrders] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [previewAs, setPreviewAs] = useState<'subscriber' | 'order'>('subscriber');

  const load = useCallback(() => {
    if (!token) return;
    adminGetCampaign(token, id)
      .then((c) => {
        const data = c as Campaign;
        setCampaign(data);
        setForm({
          name: data.name,
          subject: data.subject,
          preheader: data.preheader ?? '',
          headline: data.headline ?? '',
          subhead: data.subhead ?? '',
          badge: data.badge ?? '',
          body: data.body,
          ctaLabel: data.ctaLabel ?? '',
          ctaUrl: data.ctaUrl ?? '',
          productIds: data.productIds ?? [],
          audience: data.audience,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token, id]);

  useEffect(() => {
    load();
  }, [load]);

  // The headcount is fetched live rather than stored, because it is decision
  // support: what matters when someone is about to press Send is how many
  // people that audience means *right now*.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    adminAudienceCount(token, form.audience)
      .then((r) => {
        if (cancelled) return;
        setAudienceCount(r.count);
        setFromOrders(r.fromOrders ?? 0);
      })
      .catch(() => !cancelled && setAudienceCount(null));
    return () => {
      cancelled = true;
    };
  }, [token, form.audience]);

  // The catalogue for the product picker. Add-on-only supplies (swabs,
  // syringes) are left out — nobody opens an email for a swab.
  useEffect(() => {
    if (!token) return;
    adminGetProducts(token, { limit: '100' })
      .then((r) => setProducts(r.data.filter((p) => p.active && !p.addOnOnly)))
      .catch(() => {});
  }, [token]);

  // The preview is the server's own render — same template, same live prices
  // and stock the worker will use — refetched after every save.
  useEffect(() => {
    if (!token || !campaign) return;
    let cancelled = false;
    adminPreviewCampaign(token, id, previewAs === 'order' ? 'order' : undefined)
      .then((r) => !cancelled && setPreview(r.html))
      .catch(() => !cancelled && setPreview(null));
    return () => {
      cancelled = true;
    };
  }, [token, id, campaign, savedAt, previewAs]);

  const isDraft = campaign?.status === 'DRAFT';

  const save = async (patch: Partial<typeof form> = {}) => {
    if (!token || !isDraft) return;
    const next = { ...form, ...patch };
    setSaving(true);
    try {
      // Empty optional fields go up as null, which clears them; leaving the
      // key out would keep whatever was saved before.
      await adminUpdateCampaign(token, id, {
        name: next.name,
        subject: next.subject,
        preheader: next.preheader || null,
        headline: next.headline || null,
        subhead: next.subhead || null,
        badge: next.badge || null,
        body: next.body,
        ctaLabel: next.ctaLabel || null,
        ctaUrl: next.ctaUrl || null,
        productIds: next.productIds,
        audience: next.audience,
      });
      setSavedAt(Date.now());
    } catch {
      /* leave the form as-is so nothing typed is lost */
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!token || !testEmail.trim()) return;
    setTestState('sending');
    try {
      // Save first — otherwise the test renders whatever was last persisted,
      // which is the most confusing possible outcome of pressing "send test".
      await save();
      await adminSendTestCampaign(token, id, testEmail.trim());
      setTestState('sent');
    } catch {
      setTestState('error');
    }
  };

  const send = async () => {
    if (!token) return;
    setSendError('');
    try {
      await save();
      await adminSendCampaign(token, id);
      setConfirmSend(false);
      setConfirmText('');
      load();
    } catch (err: unknown) {
      const message =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : undefined;
      setSendError(message || 'Could not start the send');
    }
  };

  // Typing autosaves after a short pause, so the preview beside the editor
  // keeps up without anyone pressing anything. Blur still saves at once.
  const [dirty, setDirty] = useState(0);
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty((n) => n + 1);
  };
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => saveRef.current(), 900);
    return () => clearTimeout(t);
  }, [dirty]);

  if (loading) {
    return (
      <div className="animate-pulse grid xl:grid-cols-2 gap-6">
        <div className="h-[70vh] bg-surface-elevated rounded-xl" />
        <div className="h-[70vh] bg-surface-elevated rounded-xl" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="text-center py-16">
        <p className="text-text-muted">That campaign doesn&apos;t exist.</p>
        <Link href="/admin/campaigns" className="text-primary underline underline-offset-4 text-sm mt-2 inline-block">
          Back to campaigns
        </Link>
      </div>
    );
  }

  // "1 person" / "2 people" — a campaign that went to exactly one address is
  // common enough here (a re-send to a single fixed subscriber, an early list)
  // that "1 people" would show up regularly.
  const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
  const delivered = (campaign.delivery.SENT ?? 0) + (campaign.delivery.DELIVERED ?? 0);
  const pending = campaign.delivery.PENDING ?? 0;
  const failed =
    (campaign.delivery.FAILED ?? 0) + (campaign.delivery.BOUNCED ?? 0) + (campaign.delivery.COMPLAINED ?? 0);
  const inboxLine = form.preheader.trim() || form.body.replace(/\s+/g, ' ').trim().slice(0, 140);

  return (
    <div>
      <Animate variant="fadeUp">
        <PageHeader
          back="/admin/campaigns"
          title={campaign.name}
          subtitle={
            isDraft
              ? saving
                ? 'Draft · saving…'
                : savedAt
                  ? 'Draft · saved'
                  : 'Draft · nothing has been sent'
              : campaign.sentAt
                ? `Sent ${formatDate(campaign.sentAt)} to ${people(campaign.recipientCount)}`
                : `Sending to ${people(campaign.recipientCount)}…`
          }
          actions={
            isDraft ? (
              <Button type="button" onClick={() => setConfirmSend(true)} disabled={!audienceCount}>
                <Send className="w-4 h-4" /> Send to {audienceCount === null ? '…' : people(audienceCount)}
              </Button>
            ) : (
              <Badge className={campaign.status === 'SENT' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
                {campaign.status === 'SENT' ? 'Sent' : 'Sending'}
              </Badge>
            )
          }
        />
      </Animate>

      <div className="grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-6 items-start">
        {/* ---------------- Left: the work ---------------- */}
        <Animate variant="fadeUp" delay={0.05}>
          {isDraft ? (
            <div className="space-y-4">
              <Step n={1} title="Inbox" hint="What people see before they open it.">
                <Field label="Subject line" htmlFor="subject">
                  <input
                    id="subject"
                    value={form.subject}
                    onChange={(e) => set({ subject: e.target.value })}
                    onBlur={() => save()}
                    className={INPUT}
                  />
                  <p className={cn('text-xs mt-1', form.subject.length > SUBJECT_TARGET ? 'text-amber-700' : 'text-text-muted')}>
                    {form.subject.length}/{SUBJECT_TARGET} characters. Short subjects open best; a number in it helps.
                  </p>
                </Field>
                <Field label="Preview text" optional htmlFor="preheader">
                  <input
                    id="preheader"
                    value={form.preheader}
                    onChange={(e) => set({ preheader: e.target.value })}
                    onBlur={() => save()}
                    className={INPUT}
                  />
                  <p className="text-xs text-text-muted mt-1">
                    The grey line after the subject. Left blank, the opening of the message is used.
                  </p>
                </Field>
                <Field label="Internal name" htmlFor="name">
                  <input
                    id="name"
                    value={form.name}
                    onChange={(e) => set({ name: e.target.value })}
                    onBlur={() => save()}
                    className={INPUT}
                  />
                  <p className="text-xs text-text-muted mt-1">Only you see this. It also tags the links for analytics.</p>
                </Field>
              </Step>

              <Step n={2} title="Header" hint="The black panel at the top of the email.">
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label="Badge" optional htmlFor="badge">
                    <input
                      id="badge"
                      value={form.badge}
                      maxLength={32}
                      onChange={(e) => set({ badge: e.target.value })}
                      onBlur={() => save()}
                      placeholder="Limited stock"
                      className={INPUT}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Headline" htmlFor="headline">
                      <input
                        id="headline"
                        value={form.headline}
                        maxLength={120}
                        onChange={(e) => set({ headline: e.target.value })}
                        onBlur={() => save()}
                        placeholder={form.subject || 'Defaults to the subject'}
                        className={INPUT}
                      />
                    </Field>
                  </div>
                </div>
                <Field label="Second line" optional htmlFor="subhead">
                  <input
                    id="subhead"
                    value={form.subhead}
                    maxLength={120}
                    onChange={(e) => set({ subhead: e.target.value })}
                    onBlur={() => save()}
                    placeholder="Grey, under the headline"
                    className={INPUT}
                  />
                </Field>
              </Step>

              <Step n={3} title="Message">
                <Field label="Body" htmlFor="body">
                  <textarea
                    id="body"
                    rows={7}
                    value={form.body}
                    onChange={(e) => set({ body: e.target.value })}
                    onBlur={() => save()}
                    className={cn(INPUT, 'py-2.5 leading-relaxed')}
                  />
                  <p className="text-xs text-text-muted mt-1">
                    <span className={cn(wordCount(form.body) > BODY_TARGET && 'text-amber-700')}>
                      {wordCount(form.body)}/{BODY_TARGET} words.
                    </span>{' '}
                    Plain text; a blank line starts a new paragraph.
                  </p>
                </Field>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Button label" optional htmlFor="ctaLabel">
                    <input
                      id="ctaLabel"
                      value={form.ctaLabel}
                      onChange={(e) => set({ ctaLabel: e.target.value })}
                      onBlur={() => save()}
                      placeholder="Shop all compounds"
                      className={INPUT}
                    />
                  </Field>
                  <Field label="Button link" htmlFor="ctaUrl">
                    <input
                      id="ctaUrl"
                      type="url"
                      value={form.ctaUrl}
                      onChange={(e) => set({ ctaUrl: e.target.value })}
                      onBlur={() => save()}
                      placeholder="https://ascendpeptides.my/products"
                      className={INPUT}
                    />
                  </Field>
                </div>
                <p className="text-xs text-text-muted -mt-1">
                  Both are needed for the button to appear. Links to the store are tagged for analytics automatically.
                </p>
              </Step>

              <Step n={4} title="Products" hint="The first gets the big card; the rest sit two to a row. Price and stock are read at send time.">
                <ProductPicker
                  products={products}
                  selected={form.productIds}
                  search={productSearch}
                  onSearch={setProductSearch}
                  disabled={!isDraft}
                  onChange={(productIds) => {
                    setForm((f) => ({ ...f, productIds }));
                    save({ productIds });
                  }}
                />
              </Step>

              <Step n={5} title="Audience">
                <div className="space-y-2">
                  {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((value) => (
                    <label
                      key={value}
                      className={cn(
                        'flex items-start gap-2.5 p-3 rounded-lg border transition-colors cursor-pointer',
                        form.audience === value ? 'border-primary bg-primary/5' : 'border-border hover:border-border-hover'
                      )}
                    >
                      <input
                        type="radio"
                        name="audience"
                        checked={form.audience === value}
                        onChange={() => {
                          setForm((f) => ({ ...f, audience: value }));
                          setAudienceCount(null);
                          save({ audience: value });
                        }}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block text-sm font-medium">{AUDIENCE_LABELS[value]}</span>
                        <span className="block text-xs text-text-muted mt-0.5 leading-relaxed">{AUDIENCE_HINTS[value]}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1 text-sm">
                  <Users className="w-4 h-4 text-text-muted" />
                  <span className="text-text-secondary">
                    {audienceCount === null ? 'Counting…' : people(audienceCount)}
                    {audienceCount !== null && form.audience === 'CUSTOMERS' && fromOrders > 0 && (
                      <span className="text-text-muted"> · {fromOrders} added from orders on send</span>
                    )}
                  </span>
                </div>
              </Step>

              <Step n={6} title="Test, then send">
                <div>
                  <p className="text-xs text-text-muted mb-2 leading-relaxed">
                    A test goes to one address only, with [TEST] in the subject. Nobody on the list is touched.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={testEmail}
                      onChange={(e) => {
                        setTestEmail(e.target.value);
                        setTestState('idle');
                      }}
                      placeholder="you@ascendpeptides.my"
                      className={cn(INPUT, 'flex-1 min-w-0')}
                    />
                    <Button variant="outline" type="button" onClick={sendTest} disabled={testState === 'sending' || !testEmail.trim()}>
                      {testState === 'sending' ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube2 className="w-4 h-4" />}
                      Send test
                    </Button>
                  </div>
                  {testState === 'sent' && (
                    <p className="text-xs text-green-700 mt-2 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> Test sent. Check it on your phone too.
                    </p>
                  )}
                  {testState === 'error' && <p className="text-xs text-danger mt-2">Couldn&apos;t send that test.</p>}
                </div>
                <div className="pt-3 border-t border-border">
                  <Button type="button" className="w-full" onClick={() => setConfirmSend(true)} disabled={!audienceCount}>
                    <Send className="w-4 h-4" /> Send to {audienceCount === null ? '…' : people(audienceCount)}
                  </Button>
                  <p className="text-xs text-text-muted mt-2 text-center">There is no unsend.</p>
                  {sendError && <p className="text-xs text-danger mt-2">{sendError}</p>}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!token) return;
                    await adminDeleteCampaign(token, id);
                    router.push('/admin/campaigns');
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm text-text-muted hover:text-danger hover:bg-red-50 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" /> Delete draft
                </button>
              </Step>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Delivered', value: delivered },
                  { label: 'Still queued', value: pending },
                  { label: 'Failed', value: failed },
                ].map((s) => (
                  <div key={s.label} className="bg-surface rounded-xl border border-border p-4">
                    <p className="text-xs text-text-muted uppercase tracking-wider">{s.label}</p>
                    <p className="font-display text-2xl font-bold mt-1">{s.value}</p>
                  </div>
                ))}
              </div>
              <div className="bg-surface rounded-xl border border-border divide-y divide-border text-sm">
                {[
                  ['Subject', campaign.subject],
                  ['Audience', AUDIENCE_LABELS[campaign.audience]],
                  ['Recipients', people(campaign.recipientCount)],
                  ['Sent', campaign.sentAt ? formatDate(campaign.sentAt) : 'In progress'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 px-4 py-3">
                    <span className="text-text-muted">{k}</span>
                    <span className="text-right font-medium">{v}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                A sent campaign is a record and can&apos;t be edited. The preview shows it with today&apos;s prices and stock,
                which may differ from what went out.
              </p>
            </div>
          )}
        </Animate>

        {/* ---------------- Right: what they'll get ---------------- */}
        <Animate variant="fadeUp" delay={0.1} className="xl:sticky xl:top-4">
          <div className="bg-surface rounded-xl border border-border overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
              <div className="flex rounded-lg border border-border p-0.5 text-xs">
                {(['subscriber', 'order'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setPreviewAs(v)}
                    className={cn(
                      'px-2.5 py-1 rounded-md cursor-pointer',
                      previewAs === v ? 'bg-surface-elevated font-medium text-text-primary' : 'text-text-muted'
                    )}
                  >
                    {v === 'subscriber' ? 'As subscriber' : 'As order customer'}
                  </button>
                ))}
              </div>
              <div className="flex rounded-lg border border-border p-0.5">
                {([
                  ['desktop', Monitor, 'Desktop width'],
                  ['mobile', Smartphone, 'Phone width'],
                ] as const).map(([v, Icon, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-label={label}
                    title={label}
                    onClick={() => setPreviewWidth(v)}
                    className={cn(
                      'p-1.5 rounded-md cursor-pointer',
                      previewWidth === v ? 'bg-surface-elevated text-text-primary' : 'text-text-muted'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
            </div>
            <div className="border-b border-border">
              <InboxRow subject={form.subject} preheader={inboxLine} />
            </div>
            <div className="xl:max-h-[calc(100vh-9rem)] xl:overflow-y-auto">
              <EmailPreview html={preview} width={previewWidth} className="py-4 min-h-[420px]" />
            </div>
          </div>
        </Animate>
      </div>

      {confirmSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="dialog-backdrop absolute inset-0 bg-black/50" onClick={() => setConfirmSend(false)} />
          <div className="dialog-panel relative bg-surface rounded-xl border border-border p-6 max-w-md w-full">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <h2 className="font-display text-lg font-bold mt-3">
              Send to {audienceCount === null ? '…' : people(audienceCount)}?
            </h2>
            <p className="text-sm text-text-secondary mt-2 leading-relaxed">
              &ldquo;{form.subject}&rdquo; goes to {AUDIENCE_LABELS[form.audience].toLowerCase()}
              {form.audience === 'CUSTOMERS' && fromOrders > 0 ? `, including ${fromOrders} customers added from orders` : ''}.
              This cannot be undone or recalled. Type <span className="font-mono font-semibold">SEND</span> to confirm.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full mt-4 px-3 py-2 rounded-lg border border-border bg-surface text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              autoFocus
            />
            {sendError && <p className="text-xs text-danger mt-2">{sendError}</p>}
            <div className="flex gap-2 mt-5">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setConfirmSend(false);
                  setConfirmText('');
                }}
              >
                Cancel
              </Button>
              <Button className="flex-1" disabled={confirmText !== 'SEND'} onClick={send}>
                <Send className="w-4 h-4" /> Send now
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const INPUT =
  'w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60';

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-start gap-3 mb-4">
        <span className="w-6 h-6 shrink-0 rounded-full bg-text-primary text-surface text-xs font-bold flex items-center justify-center">
          {n}
        </span>
        <div>
          <h2 className="font-display font-bold leading-6">{title}</h2>
          {hint && <p className="text-xs text-text-muted leading-relaxed">{hint}</p>}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[13px] leading-5 font-medium text-text-primary mb-1">
        {label} {optional && <span className="font-normal text-text-muted">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

/**
 * Featured products, in send order: the first is the large spotlight card,
 * the rest a two-up grid. Prices, photos and stock are not chosen here —
 * the email reads them live when it renders.
 */
function ProductPicker({
  products,
  selected,
  search,
  onSearch,
  onChange,
  disabled,
}: {
  products: Product[];
  selected: string[];
  search: string;
  onSearch: (v: string) => void;
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => !selected.includes(p.id))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, q ? 20 : 8);
  }, [products, selected, search]);

  const move = (i: number, d: -1 | 1) => {
    const next = [...selected];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const full = selected.length >= MAX_PRODUCTS;

  return (
    <div>
      <p className="text-xs text-text-muted mb-2">
        {selected.length}/{MAX_PRODUCTS} picked
      </p>

      {selected.length > 0 && (
        <ol className="space-y-1.5 mb-4">
          {selected.map((pid, i) => {
            const p = byId.get(pid);
            const stock = p ? stockOf(p) : 0;
            return (
              <li key={pid} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <ProductThumb product={p} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {p?.name ?? 'Product no longer exists'}
                    {i === 0 && (
                      <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wider text-primary">Spotlight</span>
                    )}
                  </p>
                  <p className={cn('text-xs', p && stock === 0 ? 'text-amber-700' : 'text-text-muted')}>
                    {p ? `${fromPrice(p)} · ${stock === 0 ? 'sold out' : `${stock} in stock`}` : 'Will be skipped'}
                  </p>
                </div>
                {!disabled && (
                  <div className="flex items-center">
                    <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30 cursor-pointer">
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button type="button" aria-label="Move down" disabled={i === selected.length - 1} onClick={() => move(i, 1)} className="p-1 text-text-muted hover:text-text-primary disabled:opacity-30 cursor-pointer">
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button type="button" aria-label="Remove" onClick={() => onChange(selected.filter((x) => x !== pid))} className="p-1 text-text-muted hover:text-danger cursor-pointer">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {!disabled && !full && (
        <>
          <div className="relative">
            <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search products to add"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {matches.map((p) => {
              const stock = stockOf(p);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange([...selected, p.id]);
                      onSearch('');
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-elevated/60 cursor-pointer"
                  >
                    <ProductThumb product={p} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm truncate">{p.name}</span>
                      <span className={cn('block text-xs', stock === 0 ? 'text-amber-700' : 'text-text-muted')}>
                        {fromPrice(p)} · {stock === 0 ? 'sold out' : `${stock} in stock`}
                      </span>
                    </span>
                    <Plus className="w-4 h-4 text-text-muted" />
                  </button>
                </li>
              );
            })}
            {matches.length === 0 && <li className="px-3 py-3 text-sm text-text-muted">No products match.</li>}
          </ul>
        </>
      )}
    </div>
  );
}

function ProductThumb({ product }: { product?: Product }) {
  const src = product?.images?.[0]?.url ?? product?.variants?.find((v) => v.imageUrl)?.imageUrl;
  return (
    <span className="w-9 h-9 shrink-0 rounded-md bg-surface-elevated overflow-hidden">
      {src && <img src={src} alt="" className="w-full h-full object-cover" />}
    </span>
  );
}
