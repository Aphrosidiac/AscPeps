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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem('ascend-admin-token');
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
