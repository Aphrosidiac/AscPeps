'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Check, Loader2, XCircle } from 'lucide-react';
import { memberConfirmEmailChange, memberMe, type AccountWhere } from '@/lib/api';
import { getMemberToken, updateMemberCache } from '@/lib/member-session';
import { apiError } from './fields';

/** Where the "confirm your new email" link lands, in the store or the portal. */
export function ConfirmEmail({ where }: { where: AccountWhere }) {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');
  const [message, setMessage] = useState(token ? '' : 'This link is missing its confirmation token.');
  // The token is single-use and StrictMode runs effects twice in development.
  const attempted = useRef(false);
  const account = where === 'group-buy' ? '/group-buy/account' : '/account';

  useEffect(() => {
    if (attempted.current || !token) return;
    attempted.current = true;
    memberConfirmEmailChange(token)
      .then(({ email }) => {
        setMessage(email);
        setState('done');
        // Refresh the cached member when this browser is signed in.
        const session = getMemberToken();
        if (session) memberMe(session).then(updateMemberCache).catch(() => {});
      })
      .catch((err) => {
        setMessage(apiError(err, 'This link is invalid or has expired.'));
        setState('failed');
      });
  }, [token]);

  return (
    <div className="mx-auto flex min-h-[60svh] max-w-md flex-col items-center justify-center px-4 py-16 text-center">
      {state === 'working' && (
        <p className="flex items-center gap-2.5 text-[#0A0A0A]/60"><Loader2 className="h-5 w-5 animate-spin" />Confirming your new email…</p>
      )}
      {state === 'done' && (
        <>
          <span className="grid h-14 w-14 place-items-center rounded-full bg-[#22C55E] text-[#0A0A0A]"><Check className="h-7 w-7" strokeWidth={3} /></span>
          <h1 className="mt-6 font-display text-[32px] font-bold leading-tight tracking-tight text-[#0A0A0A]">Email changed.</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[#0A0A0A]/60">You now sign in with <b className="font-semibold text-[#0A0A0A]">{message}</b>.</p>
          <Link href={account} className="mt-7 inline-flex h-12 items-center rounded-full bg-[#0A0A0A] px-6 text-[15px] font-semibold text-white hover:bg-[#262626]">Back to your account</Link>
        </>
      )}
      {state === 'failed' && (
        <>
          <XCircle className="h-12 w-12 text-red-600" />
          <h1 className="mt-5 font-display text-[28px] font-bold leading-tight tracking-tight text-[#0A0A0A]">Couldn&apos;t change your email</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[#0A0A0A]/60">{message} You can ask for a new link from your account.</p>
          <Link href={account} className="mt-7 inline-flex h-12 items-center rounded-full bg-[#0A0A0A] px-6 text-[15px] font-semibold text-white hover:bg-[#262626]">Go to your account</Link>
        </>
      )}
    </div>
  );
}
