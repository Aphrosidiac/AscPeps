'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * An affiliate's share link (ascendpeptides.my/?ref=AMIR5) remembers the code
 * for 30 days in this browser, and checkout offers it in one tap. It is only
 * an offer: nothing is applied until the customer presses it, and the server
 * still checks the code like any other.
 */
const KEY = 'ascend-ref-code';
const EVENT = 'ascend-ref-code';
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

function read(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw) as { code: string; at: number };
    return Date.now() - at < KEEP_MS && /^[A-Z0-9]{4,16}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** The remembered code, or null. Null on the server and the first paint. */
export function useRefCode(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export function forgetRefCode() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Mounted once on the store: picks ?ref= up from whatever page the link opened. */
export function RefCapture() {
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    const code = ref?.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code || !/^[A-Z0-9]{4,16}$/.test(code)) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
    } catch {
      return;
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return null;
}
