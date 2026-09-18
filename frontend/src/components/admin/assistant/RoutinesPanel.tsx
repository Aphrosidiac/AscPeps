'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MoonStar, Sunrise, X } from 'lucide-react';
import { Toggle, SelectInput } from '@/components/admin/ui';
import { adminGetSettings, adminUpdateSettings } from '@/lib/api';
import { runDigest, runReflection, errorMessage } from '@/lib/assistant';

// The assistant's two scheduled jobs, switched here rather than in the
// environment: the nightly memory tidy-up (3am) and the morning brief to
// every operator's WhatsApp. Each can also be run now, into a thread of its
// own that shows in the list.

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
  const [busy, setBusy] = useState<string>('');

  const load = useCallback(() => {
    adminGetSettings(token)
      .then(setSettings)
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
              description="Once a day, to every operator's WhatsApp: new orders, anything unpaid or unshipped, low stock, the outbox."
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
              description="At 3am it re-reads the day's conversations and tidies its memory blocks — merges duplicates, drops what expired, keeps what an operator said."
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
