'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Mail, Lock, User, MailCheck } from 'lucide-react';
import { memberRegister } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AccountShell } from '../AccountShell';
import { safeNextPath } from '../safe-next';

export function RegisterClient() {
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get('next'));

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sentMessage, setSentMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { message } = await memberRegister({ email, password, displayName });
      setSentMessage(message);
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(message || 'Could not create that account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // The API answers identically whether or not the address was already taken
  // (it must not become a way to test which emails have accounts), so this
  // confirmation is worded conditionally to stay truthful in both cases.
  if (sentMessage) {
    return (
      <AccountShell title="Check your inbox">
        <div className="text-center py-2">
          <MailCheck className="w-8 h-8 text-primary mx-auto mb-3" />
          <p className="text-sm text-text-secondary leading-relaxed">{sentMessage}</p>
          <p className="text-xs text-text-muted mt-4">The link expires in 24 hours.</p>
          <Link
            href={`/account/login?next=${encodeURIComponent(next)}`}
            className="inline-block mt-5 text-sm text-text-primary underline hover:text-primary transition-colors"
          >
            Back to sign in
          </Link>
        </div>
      </AccountShell>
    );
  }

  return (
    <AccountShell
      title="Create an account"
      subtitle="Comments are public. Your display name is shown; your email never is."
      footer={
        <>
          Already have one?{' '}
          <Link
            href={`/account/login?next=${encodeURIComponent(next)}`}
            className="text-text-primary underline hover:text-primary transition-colors"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          icon={User}
          label="Display name"
          id="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={40}
          autoComplete="nickname"
          required
        />
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
          minLength={8}
          autoComplete="new-password"
          required
        />
        <p className="text-xs text-text-muted">At least 8 characters.</p>

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AccountShell>
  );
}
