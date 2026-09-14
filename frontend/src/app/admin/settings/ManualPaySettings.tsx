'use client';

import { useMemo } from 'react';
import { MethodsSettings } from 'manualpaygate/ui';
import { checkoutConfigSchema, type CheckoutConfig } from 'manualpaygate/core';
import 'manualpaygate/styles.css';

/**
 * The whole hosted-checkout config (branding + methods, each with its on/off
 * switch) travels as ONE JSON setting, `manualpay_config`, so it saves with
 * the rest of the form. The server re-validates it with the same schema on
 * save and refuses to switch `manual_payment_enabled` on with nothing enabled.
 */
export const MANUALPAY_CONFIG_KEY = 'manualpay_config';

const DEFAULTS: CheckoutConfig = {
  branding: { merchantName: 'Ascend MY', accentColor: '#0074d4' },
  methods: [],
};

/**
 * The editor's draft round-trips through this on every keystroke, so it
 * must NOT be validated here: a method that was just added has an empty QR
 * URL, which the strict schema rejects — and falling back to DEFAULTS at
 * that point made the card the admin had just added vanish before they
 * could fill it in. Shape-check only; the server validates on save and
 * reports the field that is wrong.
 */
export function parseManualPayConfig(raw: string | undefined): CheckoutConfig {
  if (!raw) return DEFAULTS;
  try {
    const parsed = JSON.parse(raw) as Partial<CheckoutConfig>;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.methods) || !parsed.branding || typeof parsed.branding !== 'object') {
      return DEFAULTS;
    }
    return { ...DEFAULTS, ...parsed, branding: { ...DEFAULTS.branding, ...parsed.branding }, methods: parsed.methods } as CheckoutConfig;
  } catch {
    return DEFAULTS;
  }
}

/** Strict parse for readers that need a valid config (never the editor). */
export function parseManualPayConfigStrict(raw: string | undefined): CheckoutConfig {
  if (!raw) return DEFAULTS;
  try {
    const parsed = checkoutConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function ManualPaySettings({ raw, onChange }: { raw: string | undefined; onChange: (json: string) => void }) {
  const value = useMemo(() => parseManualPayConfig(raw), [raw]);
  return (
    <div className="mpg-admin">
      <MethodsSettings value={value} onChange={(next) => onChange(JSON.stringify(next))} />
    </div>
  );
}
