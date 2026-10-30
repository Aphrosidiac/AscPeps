'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Member } from '@/types';
import { memberMe } from './api';

// Mirrors the admin's `ascend-admin-token` convention (localStorage + an
// Authorization header) rather than an httpOnly cookie. That is a deliberate
// trade: reading a cookie in a Server Component would opt the article page
// into dynamic rendering, and Insights pages are statically cached for SEO —
// see the `next: { revalidate }` note in lib/server-api.ts. Keeping the
// session client-side lets the article stay static while the composer alone
// knows who you are.
const TOKEN_KEY = 'ascend-member-token';
const MEMBER_KEY = 'ascend-member';

// Same-tab listeners: the native `storage` event only fires in OTHER tabs, so
// signing in would not update the composer on the page you signed in from.
const CHANGE_EVENT = 'ascend-member-change';

// Storage can throw (site data blocked); these run during render, so a throw
// would take the whole page down. No storage reads as signed out.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getMemberToken(): string | null {
  if (typeof window === 'undefined') return null;
  return read(TOKEN_KEY);
}

export function setMemberSession(token: string, member: Member): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(MEMBER_KEY, JSON.stringify(member));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Replaces the cached member after an account change, keeping the token. */
export function updateMemberCache(member: Member): void {
  localStorage.setItem(MEMBER_KEY, JSON.stringify(member));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearMemberSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(MEMBER_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function parseMember(raw: string | null): Member | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Member;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
const noSubscribe = () => () => {};

export interface MemberSession {
  member: Member | null;
  token: string | null;
  // False until the first client-side read completes. Components must not
  // render a signed-out state before this flips, or every signed-in reader
  // sees a flash of "sign in to comment" on load.
  ready: boolean;
  signOut: () => void;
}

export function useMemberSession(): MemberSession {
  // Read through useSyncExternalStore: the server snapshot (null, not ready)
  // is what hydration renders, so there's no mismatch with localStorage, and
  // sign-in/out in this tab or another re-renders every reader.
  const token = useSyncExternalStore(subscribe, getMemberToken, () => null);
  const memberRaw = useSyncExternalStore(subscribe, () => read(MEMBER_KEY), () => null);
  const member = useMemo(() => parseMember(memberRaw), [memberRaw]);
  const ready = useSyncExternalStore(noSubscribe, () => true, () => false);

  // Re-fetch the member against the API once per mount. The cached copy can be
  // stale in the way that matters most — someone who confirmed their email in
  // another tab would otherwise keep seeing "confirm your inbox" here. Also
  // acts as the expiry check: a rejected token clears the session.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    memberMe(token)
      .then((fresh) => {
        if (cancelled) return;
        localStorage.setItem(MEMBER_KEY, JSON.stringify(fresh));
        window.dispatchEvent(new Event(CHANGE_EVENT));
      })
      .catch((err) => {
        // Only an auth failure means the session is dead; a network blip or a
        // 500 must not sign the reader out.
        const status = err?.response?.status;
        if (!cancelled && (status === 401 || status === 403)) {
          clearMemberSession();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const signOut = useCallback(() => {
    clearMemberSession();
  }, []);

  return { member, token, ready, signOut };
}
