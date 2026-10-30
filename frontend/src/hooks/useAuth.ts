'use client';

import { createContext, useContext, useEffect, useCallback, useSyncExternalStore, type ReactNode } from 'react';
import React from 'react';

interface AuthContextType {
  token: string | null;
  setToken: (t: string | null) => void;
  logout: () => void;
  loading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

/** True once the JWT's `exp` has passed (or it cannot be read). Admin tokens
 *  last 24h; a stale one is dropped before any admin page renders, instead of
 *  showing the dashboard until its first request comes back 401. */
function tokenExpired(token: string): boolean {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { exp } = JSON.parse(atob(payload)) as { exp?: number };
    return typeof exp === 'number' && exp * 1000 <= Date.now() + 30_000;
  } catch {
    return true;
  }
}

const KEY = 'ascend-admin-token';
// Same-tab listeners: the native `storage` event only reaches other tabs.
const CHANGE_EVENT = 'ascend-admin-change';

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function readToken(): string | null {
  const saved = localStorage.getItem(KEY);
  return saved && !tokenExpired(saved) ? saved : null;
}

const noSubscribe = () => () => {};

export function AuthProvider({ children }: { children: ReactNode }) {
  // Read through useSyncExternalStore: null and `loading` on the server and
  // during hydration, then the stored token — no mount effect setting state.
  const token = useSyncExternalStore(subscribe, readToken, () => null);
  const loading = useSyncExternalStore(noSubscribe, () => false, () => true);

  // An expired token is ignored by readToken; this clears it from storage.
  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (saved && tokenExpired(saved)) localStorage.removeItem(KEY);
  }, []);

  const setToken = useCallback((t: string | null) => {
    if (t) {
      localStorage.setItem(KEY, t);
    } else {
      localStorage.removeItem(KEY);
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const logout = useCallback(() => setToken(null), [setToken]);

  return React.createElement(
    AuthContext,
    { value: { token, setToken, logout, loading, isAuthenticated: !!token } },
    children
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
