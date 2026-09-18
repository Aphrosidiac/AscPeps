'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, MoonStar, Sunrise, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Toggle, SelectInput } from '@/components/admin/ui';
import { adminAgentOperators, adminAgentSaveOperator, adminGetSettings, adminUpdateSettings } from '@/lib/api';
import { runDigest, runReflection, errorMessage } from '@/lib/assistant';

// The assistant's two scheduled jobs, switched here rather than in the
// environment: the nightly memory tidy-up (3am) and the morning brief. Each
// can also be run now, into a thread of its own that shows in the list.
//
// Who receives the brief is decided here too, per operator. The recipients
// can only ever be people on the WhatsApp allowlist — the brief is a message
// from the business number, and that list is the whole set of people it may
// speak to — so this shows the allowlist with a switch on each row, and
// adding someone means adding them there.

interface Operator {
  id: string;
  phone: string;
  name: string;
  active: boolean;
  canWrite: boolean;
  morningBrief: boolean;
}

const KEYS = {
  reflect: 'agent_nightly_reflection',
  digest: 'agent_morning_brief',
  digestHour: 'agent_morning_brief_hour',
} as const;

export function RoutinesPanel({
  token,
  onClose,
  onNotice,
  onStarted,
}: {
  token: string;
  onClose: () => void;
  onNotice: (kind: 'ok' | 'bad', text: string) => void;
  onStarted: (threadId: string) => void;
}) {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [busy, setBusy] = useState<string>('');

  const load = useCallback(() => {
    adminGetSettings(token)
      .then(setSettings)
      .catch((e) => onNotice('bad', errorMessage(e)));
    adminAgentOperators(token)
      .then((r) => setOperators((r.operators ?? []) as Operator[]))
      .catch((e) => onNotice('bad', errorMessage(e)));
  }, [token, onNotice]);
  useEffect(() => {
    load();
  }, [load]);

  const set = (patch: Record<string, string>) => {
    setSettings((s) => ({ ...(s ?? {}), ...patch }));
    adminUpdateSettings(token, patch).catch((e) => {
      onNotice('bad', errorMessage(e));
      load();
    });
  };

  const setRecipient = (op: Operator, on: boolean) => {
    setOperators((ops) => ops.map((o) => (o.id === op.id ? { ...o, morningBrief: on } : o)));
    adminAgentSaveOperator(token, { phone: op.phone, name: op.name, active: op.active, canWrite: op.canWrite, morningBrief: on }).catch((e) => {
      onNotice('bad', errorMessage(e));
      load();
    });
  };

  const run = (which: 'reflect' | 'digest') => {
    setBusy(which);
    const job =
      which === 'reflect'
        ? runReflection(token).then((r) => {
            onNotice('ok', 'Reflection started');
            return r.threadId;
          })
        : runDigest(token).then((r) => {
            onNotice('ok', 'Writing the brief — it is sent to the operators when done');
            return r.threadId;
          });
    job
      .then(onStarted)
      .catch((e) => onNotice('bad', errorMessage(e)))
      .finally(() => setBusy(''));
  };

  const hour = Number(settings?.[KEYS.digestHour] ?? 8);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <p className="min-w-0 flex-1 truncate text-[15px] font-medium leading-5 text-text-primary">Routines</p>
        <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-lg text-text-secondary hover:text-text-primary">
          <X className="h-5 w-5" strokeWidth={1.5} />
        </button>
      </div>
      {!settings ? (
        <p className="p-4 text-[13px] text-text-secondary">Loading…</p>
      ) : (
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
          <section className="space-y-3">
            <Toggle
              checked={settings[KEYS.digest] === 'true'}
              onChange={(v) => set({ [KEYS.digest]: v ? 'true' : 'false' })}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <Sunrise className="h-4 w-4 text-text-muted" strokeWidth={1.5} /> Morning brief
                </span>
              }
              description="Once a day, as a WhatsApp message: new orders, anything unpaid or unshipped, low stock, the outbox."
            />
            <div className="flex items-center gap-3 pl-14">
              <label className="text-[13px] text-text-secondary" htmlFor="digest-hour">
                At
              </label>
              <div className="w-28">
                <SelectInput id="digest-hour" value={String(hour)} onChange={(e) => set({ [KEYS.digestHour]: e.target.value })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, '0')}:00
                    </option>
                  ))}
                </SelectInput>
              </div>
              <button
                disabled={!!busy}
                onClick={() => run('digest')}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-50"
              >
                {busy === 'digest' && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />} Send now
              </button>
            </div>

            <div className="pl-14">
              <p className="text-[12px] font-medium uppercase tracking-wide text-text-secondary">Sent to</p>
              {!operators.filter((o) => o.active).length ? (
                <p className="mt-1 text-[13px] leading-[18px] text-text-secondary">Nobody yet — the brief goes to people on the WhatsApp allowlist.</p>
              ) : (
                <ul className="mt-1 divide-y divide-border/60 rounded-[8px] border border-border">
                  {operators
                    .filter((o) => o.active)
                    .map((o) => (
                      <li key={o.id} className="flex items-center gap-3 px-3 py-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={o.morningBrief}
                          aria-label={`Send the morning brief to ${o.name}`}
                          onClick={() => setRecipient(o, !o.morningBrief)}
                          className={cn(
                            'h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-[180ms]',
                            o.morningBrief ? 'bg-primary' : 'bg-border-hover'
                          )}
                        >
                          <span
                            className={cn(
                              'block h-4 w-4 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-[180ms]',
                              o.morningBrief ? 'translate-x-4' : 'translate-x-0'
                            )}
                          />
                        </button>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] leading-5 text-text-primary">{o.name}</span>
                          <span className="block text-[12px] leading-4 text-text-secondary">
                            {o.phone}
                            {!o.canWrite ? ' · read-only' : ''}
                          </span>
                        </span>
                      </li>
                    ))}
                </ul>
              )}
              <p className="mt-1.5 text-[12px] leading-4 text-text-secondary">
                Only people on the WhatsApp allowlist can receive it — it is a message from the business number.{' '}
                <Link href="/admin/agent" className="font-medium text-text-primary underline underline-offset-2">
                  Manage the allowlist
                </Link>
              </p>
            </div>
          </section>

          <section className="space-y-3">
            <Toggle
              checked={settings[KEYS.reflect] === 'true'}
              onChange={(v) => set({ [KEYS.reflect]: v ? 'true' : 'false' })}
              label={
                <span className="inline-flex items-center gap-1.5">
                  <MoonStar className="h-4 w-4 text-text-muted" strokeWidth={1.5} /> Nightly reflection
                </span>
              }
              description="At 3am it re-reads what operators said and tidies its memory — merges duplicates, drops what expired, moves detail out of core/."
            />
            <div className="pl-14">
              <button
                disabled={!!busy}
                onClick={() => run('reflect')}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium text-text-primary hover:bg-surface-elevated disabled:opacity-50"
              >
                {busy === 'reflect' && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />} Run now
              </button>
            </div>
          </section>

          <p className="text-[12px] leading-4 text-text-secondary">
            Both run at most once per day (Malaysia time). A manual run counts as today’s. Neither changes orders, products or settings.
          </p>
        </div>
      )}
    </div>
  );
}
