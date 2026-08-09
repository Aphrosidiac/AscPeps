'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Send, TestTube2, Trash2, Users, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminGetCampaign,
  adminUpdateCampaign,
  adminDeleteCampaign,
  adminSendTestCampaign,
  adminSendCampaign,
  adminAudienceCount,
} from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Animate } from '@/components/ui/Animate';
import { AUDIENCE_LABELS } from '../page';

type Audience = 'ALL' | 'BUYERS' | 'NON_BUYERS';

interface Campaign {
  id: string;
  name: string;
  subject: string;
  preheader: string | null;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
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
};

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
    body: '',
    ctaLabel: '',
    ctaUrl: '',
    audience: 'ALL' as Audience,
  });

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
          body: data.body,
          ctaLabel: data.ctaLabel ?? '',
          ctaUrl: data.ctaUrl ?? '',
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
      .then((r) => !cancelled && setAudienceCount(r.count))
      .catch(() => !cancelled && setAudienceCount(null));
    return () => {
      cancelled = true;
    };
  }, [token, form.audience]);

  const isDraft = campaign?.status === 'DRAFT';

  const save = async () => {
    if (!token || !isDraft) return;
    setSaving(true);
    try {
      await adminUpdateCampaign(token, id, {
        name: form.name,
        subject: form.subject,
        preheader: form.preheader || undefined,
        body: form.body,
        ctaLabel: form.ctaLabel || undefined,
        ctaUrl: form.ctaUrl || undefined,
        audience: form.audience,
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

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-8 w-48 bg-surface-elevated rounded" />
        <div className="h-64 bg-surface-elevated rounded" />
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
  const headcount = `${campaign.recipientCount} ${campaign.recipientCount === 1 ? 'person' : 'people'}`;
  const delivered = (campaign.delivery.SENT ?? 0) + (campaign.delivery.DELIVERED ?? 0);
  const pending = campaign.delivery.PENDING ?? 0;
  const failed = campaign.delivery.FAILED ?? 0;

  return (
    <div>
      <Animate variant="fadeUp">
        <Link
          href="/admin/campaigns"
          className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text-primary mb-4 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Campaigns
        </Link>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold">{campaign.name}</h1>
            <p className="text-sm text-text-muted mt-0.5">
              {isDraft
                ? 'Draft — nothing has been sent'
                : campaign.sentAt
                  ? `Sent ${formatDate(campaign.sentAt)} to ${headcount}`
                  : `Sending to ${headcount}`}
            </p>
          </div>
          {!isDraft && (
            <Badge className={campaign.status === 'SENT' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}>
              {campaign.status.charAt(0) + campaign.status.slice(1).toLowerCase()}
            </Badge>
          )}
        </div>
      </Animate>

      {!isDraft && (
        <Animate variant="fadeUp" delay={0.05}>
          <div className="grid grid-cols-3 gap-3 mb-6">
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
        </Animate>
      )}

      <Animate variant="fadeUp" delay={0.1}>
        <fieldset disabled={!isDraft} className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-text-secondary mb-1.5">
                  Internal name
                </label>
                <input
                  id="name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  onBlur={save}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60"
                />
                <p className="text-xs text-text-muted mt-1">Only you see this. Recipients never do.</p>
              </div>

              <div>
                <label htmlFor="subject" className="block text-sm font-medium text-text-secondary mb-1.5">
                  Subject line
                </label>
                <input
                  id="subject"
                  value={form.subject}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                  onBlur={save}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60"
                />
              </div>

              <div>
                <label htmlFor="preheader" className="block text-sm font-medium text-text-secondary mb-1.5">
                  Preview text <span className="font-normal text-text-muted">(optional)</span>
                </label>
                <input
                  id="preheader"
                  value={form.preheader}
                  onChange={(e) => setForm((f) => ({ ...f, preheader: e.target.value }))}
                  onBlur={save}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60"
                />
                <p className="text-xs text-text-muted mt-1">
                  The line shown next to the subject in an inbox. Left blank, the opening of the body is used.
                </p>
              </div>

              <div>
                <label htmlFor="body" className="block text-sm font-medium text-text-secondary mb-1.5">
                  Body
                </label>
                <textarea
                  id="body"
                  rows={12}
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  onBlur={save}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-surface text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60"
                />
                <p className="text-xs text-text-muted mt-1">
                  Plain text. Blank lines become paragraphs — no HTML, so nothing can break in Outlook.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ctaLabel" className="block text-sm font-medium text-text-secondary mb-1.5">
                    Button label <span className="font-normal text-text-muted">(optional)</span>
                  </label>
                  <input
                    id="ctaLabel"
                    value={form.ctaLabel}
                    onChange={(e) => setForm((f) => ({ ...f, ctaLabel: e.target.value }))}
                    onBlur={save}
                    placeholder="Shop restocks"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60"
                  />
                </div>
                <div>
                  <label htmlFor="ctaUrl" className="block text-sm font-medium text-text-secondary mb-1.5">
                    Button link
                  </label>
                  <input
                    id="ctaUrl"
                    type="url"
                    value={form.ctaUrl}
                    onChange={(e) => setForm((f) => ({ ...f, ctaUrl: e.target.value }))}
                    onBlur={save}
                    placeholder="https://ascendpeptides.my/products"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60"
                  />
                </div>
              </div>
              <p className="text-xs text-text-muted -mt-2">
                Both are needed for a button to appear. A full https:// address — relative paths don&apos;t resolve in email.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-surface rounded-xl border border-border p-5">
              <h2 className="font-display font-bold mb-3">Audience</h2>
              <div className="space-y-2">
                {(Object.keys(AUDIENCE_LABELS) as Audience[]).map((value) => (
                  <label
                    key={value}
                    className={cn(
                      'flex items-start gap-2.5 p-3 rounded-lg border transition-colors',
                      isDraft && 'cursor-pointer',
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
                      }}
                      onBlur={save}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-sm font-medium">{AUDIENCE_LABELS[value]}</span>
                      <span className="block text-xs text-text-muted mt-0.5 leading-relaxed">
                        {AUDIENCE_HINTS[value]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border text-sm">
                <Users className="w-4 h-4 text-text-muted" />
                <span className="text-text-secondary">
                  {audienceCount === null ? 'Counting…' : `${audienceCount} ${audienceCount === 1 ? 'person' : 'people'}`}
                </span>
              </div>
            </div>

            {isDraft && (
              <>
                <div className="bg-surface rounded-xl border border-border p-5">
                  <h2 className="font-display font-bold mb-1">Send a test</h2>
                  <p className="text-xs text-text-muted mb-3 leading-relaxed">
                    Goes to one address only. Nothing on the list is touched.
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
                      className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                    <Button variant="outline" type="button" onClick={sendTest} disabled={testState === 'sending'}>
                      {testState === 'sending' ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <TestTube2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                  {testState === 'sent' && (
                    <p className="text-xs text-green-700 mt-2 flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" /> Test sent.
                    </p>
                  )}
                  {testState === 'error' && (
                    <p className="text-xs text-danger mt-2">Couldn&apos;t send that test.</p>
                  )}
                </div>

                <div className="bg-surface rounded-xl border border-border p-5">
                  <h2 className="font-display font-bold mb-1">Send</h2>
                  <p className="text-xs text-text-muted mb-3 leading-relaxed">
                    There is no unsend. Once this starts, everyone in the audience gets it.
                  </p>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => setConfirmSend(true)}
                    disabled={!audienceCount}
                  >
                    <Send className="w-4 h-4" /> Send campaign
                  </Button>
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
              </>
            )}

            {isDraft && (
              <p className="text-xs text-text-muted text-center">
                {saving ? 'Saving…' : savedAt ? 'Saved' : 'Changes save when you leave a field'}
              </p>
            )}
          </div>
        </fieldset>
      </Animate>

      {confirmSend && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="dialog-backdrop absolute inset-0 bg-black/50" onClick={() => setConfirmSend(false)} />
          <div className="dialog-panel relative bg-surface rounded-xl border border-border p-6 max-w-md w-full">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            <h2 className="font-display text-lg font-bold mt-3">
              Send to {audienceCount} {audienceCount === 1 ? 'person' : 'people'}?
            </h2>
            <p className="text-sm text-text-secondary mt-2 leading-relaxed">
              This cannot be undone or recalled. Type <span className="font-mono font-semibold">SEND</span> to confirm.
            </p>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full mt-4 px-3 py-2 rounded-lg border border-border bg-surface text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              autoFocus
            />
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
