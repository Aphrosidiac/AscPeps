'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Lock } from 'lucide-react';
import { memberLogin } from '@/lib/api';
import { setMemberSession } from '@/lib/member-session';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AccountShell } from '../AccountShell';
import { safeNextPath } from '../safe-next';

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { token, member } = await memberLogin({ email, password });
      setMemberSession(token, member);
      router.push(next);
      // The article page is server-rendered and cached; without this the
      // reader lands back on a copy that still shows the signed-out composer.
      router.refresh();
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AccountShell
      title="Sign in"
      subtitle="You need an account to comment on Insights articles."
      footer={
        <>
          No account?{' '}
          <Link
            href={`/account/register?next=${encodeURIComponent(next)}`}
            className="text-text-primary underline hover:text-primary transition-colors"
          >
            Create one
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
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

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AccountShell>
  );
}
