'use client';

import { useEffect, useState } from 'react';
import { getSettings } from '@/lib/api';

// The public store settings, fetched once per visit and shared by whoever
// asks (the cart's shipping lines, the account page's perks).
let once: Promise<Record<string, string>> | null = null;

export function useStoreSettings(): Record<string, string> | null {
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    once ??= getSettings().catch(() => ({}));
    once.then((s) => alive && setSettings(s));
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}
