'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Cpu, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SelectInput } from '@/components/admin/ui';
import { errorMessage, getModelSettings, saveModelSettings, type ModelInfo, type ModelSettings } from '@/lib/assistant';

// Which model answers, which one takes over when it fails, and how much it
// thinks. One setting for both doors — the WhatsApp agent and this page run
// the same loop, so a change here is what the next WhatsApp turn uses too.
// Saved on change; the button shows the current everyday model.

const money = (n: number) => (n >= 1 ? `$${n}` : `$${n.toFixed(2)}`);

function label(m: ModelInfo | undefined, id: string): string {
  if (!m) return `${id} (custom)`;
  return `${m.label} · ${money(m.in)}/${money(m.out)} per M`;
}

export function ModelMenu({ token, onNotice, onChanged }: { token: string; onNotice: (kind: 'ok' | 'bad', text: string) => void; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [efforts, setEfforts] = useState<{ value: string; label: string }[]>([]);
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    getModelSettings(token)
      .then((r) => {
        setSettings(r.settings);
        setModels(r.models);
        setEfforts(r.efforts);
      })
      .catch((e) => onNotice('bad', errorMessage(e)));
  }, [token, onNotice]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const save = (patch: Partial<{ model: string; escalationModel: string | null; effort: string }>) => {
    setBusy(true);
    saveModelSettings(token, patch)
      .then((s) => {
        setSettings(s);
        onNotice('ok', 'Saved — next turn uses it, on WhatsApp too');
        onChanged?.();
      })
      .catch((e) => {
        onNotice('bad', errorMessage(e));
        load();
      })
      .finally(() => setBusy(false));
  };

  const current = settings ? models.find((m) => m.id === settings.model) : undefined;
  const currentSupportsEffort = current ? current.effort : true;
  const options = (ids: string[]) => [...new Set(ids)].filter(Boolean);

  return (
    <div ref={wrap} className="relative">
      <button
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex h-8 max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-medium',
          open ? 'border-primary bg-primary text-white' : 'border-border text-text-primary hover:bg-surface-elevated'
        )}
        title={settings?.model}
      >
        <Cpu className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span className="hidden truncate sm:inline">{current?.label ?? settings?.model?.replace(/^.*\//, '') ?? 'Model'}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} strokeWidth={1.75} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Model"
          className="absolute right-0 top-10 z-30 w-[22rem] max-w-[calc(100vw-2rem)] rounded-[10px] border border-border bg-surface p-4 shadow-lg"
        >
          {!settings ? (
            <p className="text-[13px] text-text-secondary">Loading…</p>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-[13px] font-medium text-text-primary" htmlFor="agent-model">
                  Model
                </label>
                <SelectInput id="agent-model" value={settings.model} disabled={busy} onChange={(e) => save({ model: e.target.value })}>
                  {options([settings.model, ...models.filter((m) => m.role !== 'escalation').map((m) => m.id)]).map((id) => (
                    <option key={id} value={id}>
                      {label(
                        models.find((m) => m.id === id),
                        id
                      )}
                    </option>
                  ))}
                </SelectInput>
                <p className="text-[12px] leading-4 text-text-secondary">{current?.fit ?? 'A custom OpenRouter id; no price known.'}</p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[13px] font-medium text-text-primary" htmlFor="agent-escalation">
                  Escalation model
                </label>
                <SelectInput
                  id="agent-escalation"
                  value={settings.escalationModel ?? ''}
                  disabled={busy}
                  onChange={(e) => save({ escalationModel: e.target.value || null })}
                >
                  <option value="">None — errors reach you</option>
                  {options([settings.escalationModel ?? '', ...models.filter((m) => m.role !== 'everyday' && m.id !== settings.model).map((m) => m.id)]).map(
                    (id) => (
                      <option key={id} value={id}>
                        {label(
                          models.find((m) => m.id === id),
                          id
                        )}
                      </option>
                    )
                  )}
                </SelectInput>
                <p className="text-[12px] leading-4 text-text-secondary">
                  Takes a turn over after a provider failure or two steps of wrong tool calls. Rare, so it may cost more.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[13px] font-medium text-text-primary" htmlFor="agent-effort">
                  Reasoning effort
                </label>
                <SelectInput
                  id="agent-effort"
                  value={settings.effort}
                  disabled={busy || !currentSupportsEffort}
                  onChange={(e) => save({ effort: e.target.value })}
                >
                  {efforts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </SelectInput>
                <p className="text-[12px] leading-4 text-text-secondary">
                  {currentSupportsEffort ? 'Shows as “Thinking” in the transcript when above none.' : 'This model does not take a reasoning setting.'}
                </p>
              </div>

              <p className="flex items-center gap-1.5 border-t border-border pt-3 text-[12px] leading-4 text-text-secondary">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
                One setting for the dashboard and WhatsApp. Prices are per million tokens; each conversation shows what it actually cost.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
