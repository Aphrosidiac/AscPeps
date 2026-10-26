'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let saved = localStorage.getItem('ascend-admin-token');
    if (saved && tokenExpired(saved)) {
      localStorage.removeItem('ascend-admin-token');
      saved = null;
    }
    setTokenState(saved);
    setLoading(false);
  }, []);

  const setToken = useCallback((t: string | null) => {
    if (t) {
      localStorage.setItem('ascend-admin-token', t);
    } else {
      localStorage.removeItem('ascend-admin-token');
    }
    setTokenState(t);
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
