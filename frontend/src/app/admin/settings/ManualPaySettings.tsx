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

export function parseManualPayConfig(raw: string | undefined): CheckoutConfig {
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
