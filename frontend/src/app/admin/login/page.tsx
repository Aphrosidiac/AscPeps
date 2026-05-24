'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminLogin } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

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
      router.push('/admin/dashboard');
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="font-display text-2xl font-bold">ASCEND Admin</h1>
          <p className="text-sm text-text-secondary mt-1">Sign in to manage your store</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface rounded-xl border border-border p-6 space-y-4">
          <Input label="Email" id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input label="Password" id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      </div>
    </div>
  );
}
