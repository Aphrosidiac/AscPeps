'use client';

import { useSyncExternalStore } from 'react';
import { X } from 'lucide-react';

/**
 * Affiliates may talk about any product in public, but Ascend's name, their
 * code and their link go out by DM or private sharing only. The banner says so in full on
 * Overview; once closed (remembered per affiliate, on this browser) the rule
 * stays as one line beside the copy buttons, and it can't be closed.
 */
const EVENT = 'ascend-aff-sharing-notice';
const key = (id: string) => `ascend-aff-sharing-notice:${id}`;
// So Close still works for this visit when storage is blocked.
const closedThisVisit = new Set<string>();

function isClosed(id: string) {
  if (closedThisVisit.has(id)) return true;
  try {
    return localStorage.getItem(key(id)) === '1';
  } catch {
    return false;
  }
}

function close(id: string) {
  closedThisVisit.add(id);
  try {
    localStorage.setItem(key(id), '1');
  } catch {
    /* kept for this visit only */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

function useClosed(id: string) {
  return useSyncExternalStore(subscribe, () => isClosed(id), () => true);
}

export function SharingBanner({ affiliateId }: { affiliateId: string }) {
  if (useClosed(affiliateId)) return null;
  return (
    <section className="mb-5 flex items-start gap-3 rounded-[18px] py-3.5 pr-3 pl-5" style={{ background: 'var(--st-warn-soft)', color: 'var(--st-warn)' }} aria-labelledby="sharing-h">
      <div className="min-w-0 flex-1 text-[13px] leading-[19px]">
        <h2 id="sharing-h" className="text-[14px] leading-5 font-semibold" style={{ color: 'var(--st-bad)' }}>Keep Ascend out of public posts</h2>
        <p className="mt-0.5">Talk about any product publicly, but never mention Ascend, your code or your link in a post, bio, comment or public group. Those go out by DM or private sharing only.</p>
      </div>
      <button type="button" onClick={() => close(affiliateId)} className="grid h-8 w-8 shrink-0 place-items-center rounded-full transition-opacity duration-[120ms] hover:opacity-70" aria-label="Close">
        <X className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden />
      </button>
    </section>
  );
}

/** The join step: open, right above the box they tick, so nobody agrees without seeing it. */
export function SharingRule() {
  return (
    <section className="mt-4 rounded-[16px] px-4 py-3 text-[13px] leading-[19px]" style={{ background: 'var(--st-warn-soft)', color: 'var(--st-warn)' }} aria-labelledby="sharing-rule-h">
      <h3 id="sharing-rule-h" className="text-[14px] leading-5 font-semibold" style={{ color: 'var(--st-bad)' }}>Keep Ascend out of public posts</h3>
      <p className="mt-0.5">Talk about any product publicly, but never mention Ascend, your code or your link in a post, bio, comment or public group, or on a coupon site. Those go out by DM or private sharing only. We may pause a code that breaks this.</p>
    </section>
  );
}

export function SharingLine({ affiliateId }: { affiliateId: string }) {
  if (!useClosed(affiliateId)) return null;
  return (
    <p className="mt-3 rounded-[14px] px-3 py-2 text-[12px] leading-[17px] font-medium" style={{ background: 'var(--st-warn-soft)', color: 'var(--st-warn)' }}>
      Never mention Ascend, your code or link publicly. DM or private sharing only.
    </p>
  );
}
