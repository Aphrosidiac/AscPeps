'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';

/**
 * The admin's dialog frame, lifted from RecordMoneyDialog so a page can put
 * a small form or a question in front of itself without hand-rolling the
 * backdrop, the exit animation, the focus trap and the Escape path again.
 *
 * `onClose` is called after the exit animation has played; call `close()`
 * from inside (it is handed to `children` and `footer` as a render prop) so
 * a successful submit leaves the same way Cancel does.
 */
const EXIT_MS = 150;

export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'sm',
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode | ((close: () => void) => ReactNode);
  footer?: ReactNode | ((close: () => void) => ReactNode);
  size?: 'sm' | 'md';
}) {
  const [closing, setClosing] = useState(false);
  const close = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, EXIT_MS);
  }, [onClose]);
  const panelRef = useModalA11y({ onClose: close });

  return (
    <div
      className={cn('dialog-backdrop fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4', closing && 'is-closing')}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        ref={panelRef}
        className={cn(
          'dialog-panel bg-surface rounded-xl border border-border w-full max-h-[90vh] overflow-y-auto outline-none',
          size === 'sm' ? 'max-w-md' : 'max-w-lg',
          closing && 'is-closing',
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="font-display text-[16px] leading-6 font-semibold text-text-primary">{title}</h2>
            {description ? <p className="mt-0.5 text-[13px] leading-[18px] text-text-secondary">{description}</p> : null}
          </div>
          <button onClick={close} aria-label="Close" className="-mr-1 p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children ? <div className="p-5">{typeof children === 'function' ? children(close) : children}</div> : null}
        {footer ? (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
            {typeof footer === 'function' ? footer(close) : footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A yes/no in the house dialog rather than `window.confirm()`: it can name
 * the consequence in more than one line, it keeps the theme, and after a few
 * native boxes the browser offers to suppress them — from then on the button
 * silently does nothing.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Confirm',
  tone = 'primary',
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  /** Shown under the body; the dialog stays open so it can be read. */
  error?: string | null;
  /** Return false to keep the dialog open (the action was refused). */
  onConfirm: () => Promise<boolean | void> | boolean | void;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={busy}>Cancel</Button>
          <Button
            type="button"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            size="sm"
            disabled={busy}
            onClick={async () => { if ((await onConfirm()) !== false) close(); }}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      )}
    >
      {body ? <p className="text-[15px] leading-[22px] text-text-secondary">{body}</p> : null}
      {error ? <p className="mt-3 text-[13px] leading-[18px] text-danger">{error}</p> : null}
    </Dialog>
  );
}
