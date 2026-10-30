'use client';

import { useState } from 'react';
import { Check, Eye, EyeOff, Lock, type LucideIcon } from 'lucide-react';

// Shared by the auth screens and account settings, so every account form has
// the same fields.

export const inputCls = 'h-11 w-full rounded-xl border border-[#0A0A0A]/15 bg-white pl-10 pr-3.5 text-[15px] text-[#0A0A0A] placeholder:text-[#0A0A0A]/35 outline-none transition-[border-color,box-shadow] focus:border-[#0A0A0A] focus:ring-4 focus:ring-[#0A0A0A]/[0.06] disabled:bg-[#0A0A0A]/[0.03] disabled:text-[#0A0A0A]/55';

export const MIN_PASSWORD = 8;

/** An icon-led input; the label is for screen readers unless `showLabel`. */
export function Field({ id, label, icon: Icon, showLabel, children }: { id: string; label: string; icon: LucideIcon; showLabel?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={showLabel ? 'mb-1.5 block text-[13px] font-medium text-[#0A0A0A]/70' : 'sr-only'}>{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0A0A0A]/40" />
        {children}
      </div>
    </div>
  );
}

/**
 * Password input with show/hide. `fresh` marks a new password: it gets the
 * live length check inside the field, so typing never shifts the layout.
 */
export function PasswordField({ id, label, value, onChange, fresh, showLabel, placeholder }: {
  id: string; label: string; value: string; onChange: (v: string) => void; fresh?: boolean; showLabel?: boolean; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const longEnough = value.length >= MIN_PASSWORD;
  return (
    <Field id={id} label={label} icon={Lock} showLabel={showLabel}>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={fresh ? 'new-password' : 'current-password'}
        required
        minLength={fresh ? MIN_PASSWORD : undefined}
        placeholder={placeholder ?? (fresh ? `Password (${MIN_PASSWORD}+ characters)` : 'Password')}
        className={`${inputCls} ${fresh ? 'pr-[5.5rem]' : 'pr-11'}`}
      />
      {fresh && value && (
        <span className={`pointer-events-none absolute right-11 top-1/2 flex -translate-y-1/2 items-center gap-1 text-xs font-medium transition-colors ${longEnough ? 'text-[#15803D]' : 'text-[#0A0A0A]/40'}`}>
          <Check className="h-3.5 w-3.5" />{longEnough ? 'Good' : `${value.length}/${MIN_PASSWORD}`}
        </span>
      )}
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[#0A0A0A]/45 hover:text-[#0A0A0A] cursor-pointer">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </Field>
  );
}

/** The API's own words for a failed request: `{ error }`, or the first validation detail. */
export function apiError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { error?: string; message?: string; details?: { message?: string }[] } } })?.response?.data;
  if (!data) return fallback;
  if (data.details?.[0]?.message) return data.details[0].message;
  if (data.error && data.error !== 'Validation Error' && data.error !== 'Internal Server Error') return data.error;
  return data.message || fallback;
}
