'use client';

import { useCallback, useRef, useState } from 'react';
import { X, UploadCloud, FileText, Image as ImageIcon } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useModalA11y } from '@/hooks/useModalA11y';
import { adminUploadDocument } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LinkPicker, type LinkSelection } from './LinkPicker';

const todayIso = () => new Date().toISOString().slice(0, 10);

// Mirrors ALLOWED_MIME in backend/src/utils/document-store.ts. The server sniffs
// the real bytes regardless — this only spares the user a pointless upload.
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.avif,.heic,application/pdf,image/*';
// Matches MAX_DOCUMENT_BYTES in the API, which in turn matches nginx's
// client_max_body_size in production. Checked here too so an oversized file is
// refused with a real message instead of after a long upload that the proxy
// then kills.
const MAX_BYTES = 10 * 1024 * 1024;

/** "Invoice 20260901.pdf" -> "Invoice 20260901" — a sane default title. */
function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 160);
}

function humanSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UploadDocumentDialog({
  kinds,
  onClose,
  onSaved,
  presetLinks,
}: {
  kinds: string[];
  onClose: () => void;
  onSaved: () => void;
  /** Opened from an order or expense: that link is already the answer. */
  presetLinks?: LinkSelection;
}) {
  const { token } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('Receipt');
  const [occurredAt, setOccurredAt] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [links, setLinks] = useState<LinkSelection>(presetLinks ?? { orderIds: [], expenseIds: [] });

  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);

  const EXIT_MS = 150;
  const dismiss = useCallback((after: () => void) => {
    setClosing(true);
    setTimeout(after, EXIT_MS);
  }, []);
  const requestClose = useCallback(() => {
    if (saving) return; // never abandon an upload mid-flight
    dismiss(onClose);
  }, [dismiss, onClose, saving]);

  const panelRef = useModalA11y({ onClose: requestClose });

  const take = (picked: File | null | undefined) => {
    if (!picked) return;
    if (picked.size > MAX_BYTES) {
      setError(`That file is ${humanSize(picked.size)}. The limit is 10 MB.`);
      return;
    }
    setError('');
    setFile(picked);
    // Only prefill an untouched title — never overwrite something typed.
    setTitle((current) => (current.trim() === '' ? titleFromFilename(picked.name) : current));
  };

  const cents = amount.trim() === '' ? null : Math.round(Number(amount) * 100);
  const amountValid = cents === null || (Number.isFinite(cents) && cents >= 0);
  const valid = !!file && title.trim() !== '' && kind.trim() !== '' && occurredAt !== '' && amountValid;

  const submit = async () => {
    if (!token || !valid || !file) return;
    setError('');
    setSaving(true);
    setProgress(0);
    try {
      await adminUploadDocument(
        token,
        file,
        {
          title: title.trim(),
          description: description.trim() || undefined,
          kind: kind.trim(),
          occurredAt,
          amount: cents,
          orderIds: links.orderIds,
          expenseIds: links.expenseIds,
        },
        setProgress
      );
      dismiss(onSaved);
    } catch (err) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string; message?: string } } }).response?.data?.error
        : undefined;
      setError(message || 'Could not upload that document.');
      setSaving(false);
    }
  };

  const isPdf = file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name ?? '');

  return (
    <div
      className={cn('dialog-backdrop fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4', closing && 'is-closing')}
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label="Upload document"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        ref={panelRef}
        className={cn('dialog-panel bg-surface rounded-xl border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto outline-none', closing && 'is-closing')}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-surface z-10">
          <h2 className="font-display font-semibold">Upload document</h2>
          <button
            onClick={requestClose}
            disabled={saving}
            aria-label="Close"
            className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Drop zone. Clicking anywhere on it opens the picker, so the whole
              area is the target rather than a small link inside it. */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files?.[0]); }}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-xl px-5 py-6 text-center cursor-pointer transition-colors',
              dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-text-muted'
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              onChange={(e) => take(e.target.files?.[0])}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                {isPdf ? <FileText className="w-6 h-6 text-danger" /> : <ImageIcon className="w-6 h-6 text-primary" />}
                <div className="text-left min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-text-muted">{humanSize(file.size)} · click to replace</p>
                </div>
              </div>
            ) : (
              <>
                <UploadCloud className="w-7 h-7 text-text-muted mx-auto mb-2" />
                <p className="text-sm font-medium">Drop a file here, or click to choose</p>
                <p className="text-xs text-text-muted mt-1">PDF or image, up to 10 MB. Stored exactly as uploaded.</p>
              </>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="d-title" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Title</label>
              <input
                id="d-title" type="text" value={title} maxLength={160}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Pos Laju invoice, August"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            <div>
              <label htmlFor="d-kind" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Kind</label>
              <input
                id="d-kind" list="document-kinds" value={kind}
                onChange={(e) => setKind(e.target.value)}
                placeholder="e.g. Receipt"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
              {/* Suggests kinds already in use — what stops free text splitting
                  into Receipt / receipt / Resit. */}
              <datalist id="document-kinds">
                {['Receipt', 'Invoice', 'Bank slip', 'Statement', 'Certificate', ...kinds]
                  .filter((k, i, all) => all.indexOf(k) === i)
                  .map((k) => <option key={k} value={k} />)}
              </datalist>
            </div>

            <div>
              <label htmlFor="d-date" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">
                Date on the document
              </label>
              <input
                id="d-date" type="date" value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface"
              />
            </div>

            <div>
              <label htmlFor="d-amount" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">
                Amount <span className="normal-case tracking-normal text-text-muted">(optional)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">RM</span>
                <input
                  id="d-amount" type="number" min="0" step="0.01" value={amount}
                  onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                  className="w-full pl-10 pr-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="d-desc" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">
                Description <span className="normal-case tracking-normal text-text-muted">(optional)</span>
              </label>
              <textarea
                id="d-desc" value={description} rows={2} maxLength={2000}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Anything you'd want to know when you find this again in a year."
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface resize-y focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
              File it against <span className="normal-case tracking-normal">(optional)</span>
            </p>
            <LinkPicker value={links} onChange={setLinks} />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          {saving && (
            <div>
              <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-200" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-xs text-text-muted mt-1.5">
                {progress < 100 ? `Uploading… ${progress}%` : 'Processing…'}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-border sticky bottom-0 bg-surface">
          <button
            onClick={submit}
            disabled={!valid || saving}
            className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? 'Uploading…' : 'Upload'}
          </button>
          <button
            onClick={requestClose}
            disabled={saving}
            className="px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
