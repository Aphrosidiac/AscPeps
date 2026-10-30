'use client';

import { useState as useStateField, type ReactNode } from 'react';
import { ImagePlus, X as XIcon } from 'lucide-react';
import { adminUploadImage } from '@/lib/api';
import { Affixed, TextInput } from '@/components/admin/ui';
import { cn } from '@/lib/utils';
import type { AdminGroupBuyRow } from '@/lib/group-buy-api';

/** Small pieces the Group Buy admin screens share. */

const PHASE: Record<AdminGroupBuyRow['phase'], { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'bg-gray-100 text-gray-700' },
  UPCOMING: { label: 'Scheduled', className: 'bg-blue-50 text-blue-800' },
  LIVE: { label: 'Live', className: 'bg-green-100 text-green-800' },
  CLOSED: { label: 'Closed', className: 'bg-gray-100 text-gray-700' },
};

export function PhaseBadge({ phase }: { phase: AdminGroupBuyRow['phase'] }) {
  const p = PHASE[phase];
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium', p.className)}>{p.label}</span>;
}

/** "31 Oct, 9:00 pm" in the viewer's time. */
export function shortDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** ISO → the value a datetime-local input wants, in local time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A datetime-local value → ISO (or null when empty). */
export function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Sen → the "123.45" an RM box shows; '' for null. */
export function senToRm(sen: number | null | undefined): string {
  if (sen == null) return '';
  return (sen / 100).toFixed(2).replace(/\.00$/, '');
}

/** "123.45" → sen, null when empty, NaN when not a number. */
export function rmToSen(v: string): number | null {
  const t = v.trim().replace(/,/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export function intOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : NaN;
}

/* ---------- Fields the batch forms share ---------- */


/** An RM amount edited as text and stored as sen (null when empty). */
export function MoneyInput({ value, onChange, placeholder, id }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; id?: string }) {
  const [text, setText] = useStateField(senToRm(value));
  const [last, setLast] = useStateField(value);
  if (value !== last) { setLast(value); setText(senToRm(value)); }
  return (
    <Affixed prefix="RM">
      <input
        id={id}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const sen = rmToSen(e.target.value);
          if (sen === null || Number.isFinite(sen)) { setLast(sen); onChange(sen); }
        }}
      />
    </Affixed>
  );
}

/** A whole number (null when empty). */
export function IntInput({ value, onChange, placeholder, suffix, id, min = 0 }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; suffix?: string; id?: string; min?: number }) {
  const input = (
    <input
      id={id}
      inputMode="numeric"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => {
        const n = intOrNull(e.target.value.replace(/[^\d]/g, ''));
        if (n === null || (Number.isFinite(n) && n >= min)) onChange(n);
      }}
    />
  );
  return suffix ? <Affixed suffix={suffix}>{input}</Affixed> : <Affixed>{input}</Affixed>;
}

export function DateTimeInput({ value, onChange, id }: { value: string | null; onChange: (v: string | null) => void; id?: string }) {
  return <TextInput id={id} type="datetime-local" value={toLocalInput(value)} onChange={(e) => onChange(fromLocalInput(e.target.value))} />;
}

/** Upload or clear one image; shows it at a glance. */
export function ImageField({ token, value, onChange, hint }: { token: string; value: string | null; onChange: (url: string | null) => void; hint?: ReactNode }) {
  const [busy, setBusy] = useStateField(false);
  const [error, setError] = useStateField('');
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-[6px] border border-border bg-surface-elevated">
        {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-text-muted" />}
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-8 cursor-pointer items-center rounded-[6px] border border-border px-3 text-[13px] font-medium hover:bg-surface-elevated">
            {busy ? 'Uploading…' : value ? 'Replace' : 'Upload image'}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setBusy(true);
                setError('');
                try { onChange((await adminUploadImage(token, file)).url); }
                catch { setError('Upload failed — try a smaller JPG or PNG.'); }
                finally { setBusy(false); }
              }}
            />
          </label>
          {value && (
            <button type="button" onClick={() => onChange(null)} className="inline-flex h-8 items-center gap-1 rounded-[6px] px-2 text-[13px] text-text-secondary hover:bg-surface-elevated">
              <XIcon className="h-3.5 w-3.5" /> Remove
            </button>
          )}
        </div>
        {error ? <p className="text-[13px] text-danger">{error}</p> : hint ? <p className="text-[13px] text-text-secondary">{hint}</p> : null}
      </div>
    </div>
  );
}

/** Empty text is stored as null. */
export function nullIfEmpty(v: string): string | null {
  return v.trim() === '' ? null : v;
}
