'use client';

import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Plus, Send, Trash2 } from 'lucide-react';
import {
  adminGroupBuyNotices, adminNotifyGroupBuyStage, adminPreviewGroupBuyEmail, adminSetGroupBuyStages, errorText,
  type AdminGroupBuy, type NoticeRow,
} from '@/lib/group-buy-api';
import type { GroupBuyStage } from '@/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader, Field, SaveBar, TextArea, TextInput, Toggle } from '@/components/admin/ui';
import { EmailPreview } from '@/components/admin/EmailPreview';
import { shortDateTime, nullIfEmpty } from '../shared';

/**
 * The customer timeline. Every buyer sees these steps on their order, with the
 * batch's current step highlighted. Moving the current step forward stamps the
 * date and (when on) emails every paid buyer once.
 */
export function TimelineTab({ gb, token, onSaved, notify, setNotify }: {
  gb: AdminGroupBuy; token: string; onSaved: (gb: AdminGroupBuy) => void; notify: boolean; setNotify: (v: boolean) => void;
}) {
  const [stages, setStages] = useState<GroupBuyStage[]>(gb.stages);
  const [current, setCurrent] = useState(gb.stageKey);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [notices, setNotices] = useState<NoticeRow[]>([]);
  const [preview, setPreview] = useState('');

  // A save hands back new stages: start editing from those (during render).
  const [stagesFrom, setStagesFrom] = useState({ stages: gb.stages, key: gb.stageKey });
  if (stagesFrom.stages !== gb.stages || stagesFrom.key !== gb.stageKey) {
    setStagesFrom({ stages: gb.stages, key: gb.stageKey });
    setStages(gb.stages);
    setCurrent(gb.stageKey);
  }
  const loadNotices = () => adminGroupBuyNotices(token, gb.id).then(setNotices).catch(() => {});
  useEffect(() => { loadNotices(); }, [token, gb.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    adminPreviewGroupBuyEmail(token, gb.id, 'STAGE', current).then((r) => setPreview(r.html)).catch(() => setPreview(''));
  }, [token, gb.id, current, gb.updatedAt]);

  const at = stages.findIndex((s) => s.key === current);
  const dirty = current !== gb.stageKey || JSON.stringify(stages) !== JSON.stringify(gb.stages);
  const moving = current !== gb.stageKey;
  const update = (i: number, patch: Partial<GroupBuyStage>) => setStages((l) => l.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => setStages((l) => { const n = [...l]; const [r] = n.splice(i, 1); n.splice(i + d, 0, r); return n; });

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const r = await adminSetGroupBuyStages(token, gb.id, { stages, stageKey: current, notify });
      onSaved(r);
      setMessage({ tone: 'ok', text: r.queued ? `Saved — emailing ${r.queued} buyer${r.queued === 1 ? '' : 's'}` : 'Saved' });
      loadNotices();
    } catch (e) {
      setMessage({ tone: 'err', text: errorText(e, 'Could not save.') });
    } finally {
      setSaving(false);
    }
  };

  const resend = async () => {
    try {
      const r = await adminNotifyGroupBuyStage(token, gb.id);
      setMessage({ tone: 'ok', text: r.queued ? `Emailing ${r.queued} buyer${r.queued === 1 ? '' : 's'} who had not had this step` : 'Every paid buyer already has this step' });
      loadNotices();
    } catch (e) {
      setMessage({ tone: 'err', text: errorText(e) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="h-fit">
          <CardHeader title="Steps" description="Pick the step the batch is at. Steps before it show as done." />
          <CardBody className="space-y-3">
            {/* The step is set by hand and the window by the clock; say so when they disagree. */}
            {(gb.phase === 'LIVE' || gb.phase === 'UPCOMING') && at > 0 && (
              <p className="rounded-[8px] border border-warning/40 bg-warning/[0.06] px-4 py-3 text-[13px] text-text-primary">
                The batch is still {gb.phase === 'LIVE' ? 'taking orders' : 'waiting to open'}, but buyers will see “{stages[at]?.label}” as its current step.
              </p>
            )}
            {stages.map((s, i) => {
              const done = i < at;
              const now = i === at;
              return (
                <div key={i} className={cn('rounded-[8px] border p-4', now ? 'border-primary bg-primary/[0.03]' : 'border-border')}>
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => setCurrent(s.key)}
                      aria-label={`Set current step to ${s.label}`}
                      className={cn('mt-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                        now ? 'border-primary bg-primary text-white' : done ? 'border-text-primary bg-text-primary text-white' : 'border-border hover:border-text-secondary')}
                    >
                      {(done || now) && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                    </button>
                    <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-2">
                      <Field label="Step">
                        <TextInput value={s.label} onChange={(e) => update(i, { label: e.target.value })} />
                      </Field>
                      <Field label={done || now ? 'Reached' : 'Expected'} help={done || now ? (s.doneAt ? shortDateTime(s.doneAt) : 'Stamped when saved') : 'Free text, e.g. “Week of 8 Dec”'}>
                        <TextInput value={s.eta ?? ''} placeholder={done || now ? '' : 'Optional'} disabled={done || now} onChange={(e) => update(i, { eta: nullIfEmpty(e.target.value) })} />
                      </Field>
                      <Field label="What it means" className="md:col-span-2">
                        <TextInput value={s.detail ?? ''} onChange={(e) => update(i, { detail: nullIfEmpty(e.target.value) })} />
                      </Field>
                      <Field label="Note to buyers" help="Optional. Shown on this step and in its email." className="md:col-span-2">
                        <TextArea rows={2} value={s.note ?? ''} onChange={(e) => update(i, { note: nullIfEmpty(e.target.value) })} />
                      </Field>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)} className="flex h-7 w-7 items-center justify-center rounded text-text-secondary hover:bg-surface-elevated disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                      <button type="button" aria-label="Move down" disabled={i === stages.length - 1} onClick={() => move(i, 1)} className="flex h-7 w-7 items-center justify-center rounded text-text-secondary hover:bg-surface-elevated disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                      <button type="button" aria-label="Remove step" disabled={now || stages.length === 1} onClick={() => setStages((l) => l.filter((_, j) => j !== i))} className="flex h-7 w-7 items-center justify-center rounded text-text-secondary hover:bg-surface-elevated hover:text-danger disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setStages((l) => [...l, { key: `step-${Date.now().toString(36)}`, label: 'New step', detail: null, eta: null, note: null, doneAt: null }])}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add a step
            </button>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardBody className="space-y-3">
              <Toggle checked={notify} onChange={setNotify} label="Email buyers when the step moves on" description="Paid orders only, once per step. Saved straight away." />
              <Button variant="secondary" size="sm" onClick={resend}><Send className="w-4 h-4" /> Send current step to anyone who missed it</Button>
            </CardBody>
          </Card>
          <div>
            <p className="mb-2 text-[13px] font-medium text-text-primary">Step email <span className="font-normal text-text-secondary">· {stages[at]?.label ?? '—'}, as saved</span></p>
            {preview ? <EmailPreview html={preview} /> : <div className="h-96 rounded-[10px] bg-surface-elevated" />}
          </div>
        </div>
      </div>

      <SaveBar>
        <Button onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : moving ? `Move to “${stages[at]?.label}”` : 'Save timeline'}</Button>
        <Button variant="ghost" onClick={() => { setStages(gb.stages); setCurrent(gb.stageKey); }} disabled={!dirty || saving}>Discard</Button>
        {message ? (
          <span className={message.tone === 'ok' ? 'text-sm text-success' : 'text-sm text-danger'}>{message.text}</span>
        ) : moving ? (
          <span className="text-sm text-text-secondary">{notify ? `Paid buyers (${gb.stats.paidOrders}) will be emailed.` : 'No email — notifications are off.'}</span>
        ) : (
          <span className="text-sm text-text-secondary">{dirty ? 'Unsaved changes' : 'No unsaved changes'}</span>
        )}
      </SaveBar>

      <Card>
        <CardHeader title="Emails sent" description="Sign-up welcomes and step updates for this batch." />
        <CardBody className="p-0 sm:p-0">
          {notices.length === 0 ? (
            <p className="px-6 py-6 text-[13px] text-text-secondary">None yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="text-left text-[12px] text-text-secondary"><tr className="border-b border-border"><th className="px-6 py-2 font-medium">To</th><th className="px-3 py-2 font-medium">Email</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">When</th></tr></thead>
                <tbody>
                  {notices.map((n) => (
                    <tr key={n.id} className="border-b border-border last:border-0">
                      <td className="px-6 py-2">{n.toEmail}</td>
                      <td className="px-3 py-2">{n.kind === 'SIGNUP' ? 'Sign-up welcome' : `Step: ${gb.stages.find((s) => s.key === n.stageKey)?.label ?? n.stageKey}`}</td>
                      <td className={cn('px-3 py-2', n.status === 'FAILED' && 'text-danger', n.status === 'SENT' && 'text-success')} title={n.lastError ?? undefined}>
                        {n.status === 'PENDING' ? 'Queued' : n.status === 'SKIPPED' ? 'Skipped' : n.status === 'SENT' ? 'Sent' : 'Failed'}
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{shortDateTime(n.sentAt ?? n.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
