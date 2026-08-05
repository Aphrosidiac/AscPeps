'use client';

import { useCallback, useEffect, useState } from 'react';
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

export function getMemberToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setMemberSession(token: string, member: Member): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(MEMBER_KEY, JSON.stringify(member));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearMemberSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(MEMBER_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function readStoredMember(): Member | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(MEMBER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Member;
  } catch {
    return null;
  }
}

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
  const [member, setMember] = useState<Member | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const sync = useCallback(() => {
    setToken(getMemberToken());
    setMember(readStoredMember());
  }, []);

  useEffect(() => {
    // Deferred to an effect rather than useState's initialiser: localStorage
    // does not exist during the server render, and reading it inline would
    // produce a hydration mismatch.
    sync();
    setReady(true);

    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [sync]);

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
        setMember(fresh);
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
