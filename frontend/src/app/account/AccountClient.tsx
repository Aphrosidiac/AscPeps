'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { memberResendVerification } from '@/lib/api';
import { useMemberSession } from '@/lib/member-session';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AccountShell } from './AccountShell';

export function AccountClient() {
  const router = useRouter();
  const { member, ready, signOut } = useMemberSession();

  // Doubles as the "I never got the email" recovery path for someone who is
  // signed out, hence the free-text field rather than reusing member.email.
  const [resendEmail, setResendEmail] = useState('');
  const [resendMessage, setResendMessage] = useState('');
  const [resending, setResending] = useState(false);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    setResending(true);
    try {
      const { message } = await memberResendVerification(resendEmail || member?.email || '');
      setResendMessage(message);
    } catch {
      setResendMessage('Could not send that right now. Please try again shortly.');
    } finally {
      setResending(false);
    }
  };

  if (!ready) {
    return (
      <AccountShell title="Your account">
        <p className="text-sm text-text-muted py-2">Loading…</p>
      </AccountShell>
    );
  }

  if (!member) {
    return (
      <AccountShell
        title="Your account"
        subtitle="Sign in to manage your account, or request a new confirmation email below."
      >
        <div className="space-y-5">
          <Link href="/account/login" className="block">
            <Button className="w-full" size="lg">Sign in</Button>
          </Link>

          <form onSubmit={handleResend} className="space-y-3 pt-5 border-t border-border">
            <p className="text-sm font-medium">Resend confirmation email</p>
            <Input
              label="Email"
              id="resendEmail"
              type="email"
              value={resendEmail}
              onChange={(e) => setResendEmail(e.target.value)}
              required
            />
            <Button type="submit" variant="outline" className="w-full" disabled={resending}>
              {resending ? 'Sending…' : 'Send new link'}
            </Button>
            {resendMessage && <p className="text-sm text-text-secondary">{resendMessage}</p>}
          </form>
        </div>
      </AccountShell>
    );
  }

  return (
    <AccountShell title="Your account">
      <div className="space-y-5">
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Display name</p>
          <p className="text-sm font-medium">{member.displayName}</p>
        </div>
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wider mb-1">Email</p>
          <p className="text-sm">{member.email}</p>
        </div>

        {member.emailVerified ? (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Email confirmed — you can post comments.
          </p>
        ) : (
          <div className="bg-surface border border-border rounded-lg p-4 space-y-3">
            <p className="flex items-start gap-2 text-sm text-text-secondary">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-warning" />
              Confirm your email address before you can post.
            </p>
            <form onSubmit={handleResend}>
              <Button type="submit" variant="outline" size="sm" disabled={resending}>
                {resending ? 'Sending…' : 'Resend confirmation email'}
              </Button>
            </form>
            {resendMessage && <p className="text-sm text-text-secondary">{resendMessage}</p>}
          </div>
        )}

        <div className="pt-5 border-t border-border">
          <Button
            variant="ghost"
            onClick={() => {
              signOut();
              router.push('/insights');
              // Drops the cached server render that was produced for a signed-in
              // reader.
              router.refresh();
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </AccountShell>
  );
}
