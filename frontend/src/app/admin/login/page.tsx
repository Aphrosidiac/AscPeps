'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Mail, Lock } from 'lucide-react';
import posthog from 'posthog-js';
import { adminLogin } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Animate } from '@/components/ui/Animate';
import { MolecularNetwork } from '@/components/ui/MolecularNetwork';

export default function AdminLoginPage() {
  const router = useRouter();
  const { setToken } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { token } = await adminLogin(email, password);
      setToken(token);
      posthog.identify(email, { email, role: 'admin' });
      posthog.capture('admin_logged_in');
      router.push('/admin/dashboard');
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    // Same dark-hero treatment as the homepage: bg-primary + the animated
    // dot/line network canvas, absolutely filling this relative container
    // (AdminLayoutClient renders the login route with no sidebar chrome, so
    // this owns the full viewport on its own).
    <div className="min-h-screen bg-primary relative overflow-hidden flex items-center justify-center px-4">
      <MolecularNetwork className="absolute inset-0 w-full h-full" />

      <div className="relative z-10 w-full max-w-sm">
        <Animate variant="fade" duration={0.7}>
          <div className="flex flex-col items-center gap-3 mb-8">
            <Image src="/images/pill-icon.png" alt="" width={40} height={40} className="invert" />
            <div className="text-center">
              <h1 className="font-display text-2xl font-bold text-white tracking-tight">ASCEND</h1>
              <p className="text-sm text-white/50 mt-0.5">Admin</p>
            </div>
          </div>
        </Animate>

        <Animate variant="fadeUp" delay={0.15} duration={0.6}>
          <form onSubmit={handleSubmit} className="bg-white/95 backdrop-blur-sm rounded-2xl border border-white/10 shadow-2xl p-6 sm:p-8 space-y-5">
            <div className="text-center">
              <h2 className="font-display text-lg font-bold text-text-primary">Welcome back</h2>
              <p className="text-sm text-text-muted mt-1">Sign in to manage your store</p>
            </div>

            <div className="space-y-4">
              <Input
                icon={Mail}
                label="Email"
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
              <Input
                icon={Lock}
                label="Password"
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {error && <p className="text-sm text-danger text-center">{error}</p>}

            <Button type="submit" className="w-full" size="lg" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
        </Animate>
      </div>
    </div>
  );
}
