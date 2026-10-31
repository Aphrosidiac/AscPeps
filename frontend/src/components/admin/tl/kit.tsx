'use client';

// Teliti's admin UI kit (AscComp apps/admin/src/components/ui + edit/Counter, SerpPreview),
// ported to React one component at a time. Styles: ./tl.css. Everything renders inside a `.tl`
// root (TlRoot), modals and toasts included.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, CircleSlash, Image as ImageIcon, Link2, List, Lock, Plus, Search, Trash2,
  TriangleAlert, Upload, X, FlaskConical, BookOpen, ArrowRight, ArrowUp, ArrowDown, RefreshCw, Users, type LucideIcon,
} from 'lucide-react';
import './tl.css';

const ICONS: Record<string, LucideIcon> = {
  'arrow-left': ArrowLeft, check: Check, 'chevron-left': ChevronLeft, chevron: ChevronRight, gone: CircleSlash, image: ImageIcon,
  link: Link2, list: List, lock: Lock, plus: Plus, search: Search, trash: Trash2, warn: TriangleAlert, upload: Upload, close: X,
  vial: FlaskConical, journal: BookOpen, arrow: ArrowRight, up: ArrowUp, down: ArrowDown, replace: RefreshCw, people: Users,
};

export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const I = ICONS[name];
  return I ? <I width={size} height={size} strokeWidth={1.7} className={className} aria-hidden /> : null;
}

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function TlRoot({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('tl', className)}>{children}</div>;
}

/* ── Btn: pills; primary = Ink, signal = the one key action, ghost = hairline, subtle = text-weight ── */
type BtnProps = {
  variant?: 'primary' | 'signal' | 'ghost' | 'subtle' | 'danger';
  size?: 'sm' | 'md';
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  block?: boolean;
  href?: string;
  target?: string;
  title?: string;
  type?: 'button' | 'submit';
  onClick?: (e: React.MouseEvent) => void;
  children?: React.ReactNode;
};
export function Btn({ variant = 'ghost', size = 'md', icon, loading, disabled, block, href, target, title, type = 'button', onClick, children }: BtnProps) {
  const cls = cx('tl-btn', `v-${variant}`, `s-${size}`, block && 'block');
  const inner = (
    <>
      <span className="sweep" aria-hidden />
      <span className="inner">
        {loading ? <span className="spin" aria-hidden /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
        {children != null && <span>{children}</span>}
      </span>
    </>
  );
  if (href) {
    return href.startsWith('/') && !target ? (
      <Link href={href} className={cls} title={title}>{inner}</Link>
    ) : (
      <a href={href} target={target} rel={target === '_blank' ? 'noopener' : undefined} className={cls} title={title}>{inner}</a>
    );
  }
  return (
    <button type={type} className={cls} title={title} disabled={disabled || loading} aria-busy={loading || undefined} onClick={onClick}>
      {inner}
    </button>
  );
}

/* ── Chip: a status finds its words and tone ── */
export const STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Never published', tone: 'info' },
  live: { label: 'Live', tone: 'good' },
  changed: { label: 'Changes not live', tone: 'warn' },
  excluded: { label: 'Offline', tone: 'muted' },
};
export function Chip({ status, tone, size, children, dot = true }: { status?: string; tone?: string; size?: 'sm'; children?: React.ReactNode; dot?: boolean }) {
  const s = status ? STATUS[status] : undefined;
  const t = tone ?? s?.tone ?? 'neutral';
  return (
    <span className={cx('tl-chip', `t-${t}`, size === 'sm' && 'sm')}>
      {dot && <span className="d" />}
      {children ?? s?.label ?? status}
    </span>
  );
}

/* ── Segmented: pill toggle with a sliding highlight ── */
export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: { value: T; onChange: (v: T) => void; options: { value: T; label?: string; icon?: string; count?: number | null }[]; size?: 'sm' | 'md' }) {
  const root = useRef<HTMLDivElement>(null);
  const [hl, setHl] = useState({ x: 0, w: 0, ready: false });
  const measure = useCallback(() => {
    const el = root.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    setHl(el ? { x: el.offsetLeft, w: el.offsetWidth, ready: true } : (h) => ({ ...h, ready: false }));
  }, []);
  useLayoutEffect(measure, [measure, value, options]);
  useEffect(() => {
    if (!root.current) return;
    const ro = new ResizeObserver(measure);
    ro.observe(root.current);
    return () => ro.disconnect();
  }, [measure]);
  return (
    <div ref={root} className={cx('tl-seg', `s-${size}`)} role="group">
      <span className={cx('hl', hl.ready && 'ready')} style={{ transform: `translateX(${hl.x}px)`, width: hl.w }} />
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={15} />}
          {o.label && <span>{o.label}</span>}
          {o.count != null && <span className="count tl-num">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ── Field ── */
export function Field({ label, hint, error, required, htmlFor, children, className, ...rest }: { label?: string; hint?: React.ReactNode; error?: string | null; required?: boolean; htmlFor?: string; children: React.ReactNode; className?: string; 'data-field'?: string }) {
  return (
    <div className={cx('tl-field', error && 'invalid', className)} data-field={rest['data-field']}>
      {label && (
        <label className="flabel" htmlFor={htmlFor}>
          {label}
          {required && <span className="req" aria-hidden>*</span>}
        </label>
      )}
      <div className="control">{children}</div>
      {error ? <div className="err">{error}</div> : hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

/* ── Hint: the one quiet line that replaces an empty state ── */
export function Hint({ icon, text, tone, children }: { icon?: string; text: React.ReactNode; tone?: 'muted' | 'warn' | 'bad'; children?: React.ReactNode }) {
  return (
    <div className={cx('tl-hint-row', tone && `t-${tone}`)}>
      {icon && <Icon name={icon} size={15} className="ic" />}
      <span className="tl-grow">{text}</span>
      {children && <span className="acts">{children}</span>}
    </div>
  );
}

/* ── PageHeader: mono eyebrow, display title, a quiet line of context, actions right ── */
export function PageHeader({ eyebrow, title, back, actions, children }: { eyebrow?: string; title: string; back?: { to: string; label: string }; actions?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="tl-page-header">
      <div className="left">
        {back && (
          <Link href={back.to} className="back">
            <Icon name="arrow-left" size={14} />
            <span>{back.label}</span>
          </Link>
        )}
        {eyebrow && <div className="tl-label eyebrow">{eyebrow}</div>}
        <h1 className="tl-display title">{title}</h1>
        {children && <div className="sub">{children}</div>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

/* ── Toggle ── */
export function Toggle({ value, onChange, label, hint, disabled }: { value: boolean; onChange: (v: boolean) => void; label?: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cx('tl-toggle', value && 'on', disabled && 'disabled')}>
      <button type="button" role="switch" aria-checked={value} disabled={disabled} className="track" onClick={() => onChange(!value)}>
        <span className="knob" />
      </button>
      {(label || hint) && (
        <span className="txt">
          {label && <span className="lbl">{label}</span>}
          {hint && <span className="thint">{hint}</span>}
        </span>
      )}
    </label>
  );
}

/* ── FileDrop: drop a file or click ── */
export function FileDrop({ accept, busy, label = 'Drop a file or click to choose', hint, compact, error, onFile }: { accept?: string; busy?: boolean; label?: string; hint?: string; compact?: boolean; error?: boolean; onFile: (f: File) => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Phones have nothing to drop: "Drop an image or click to choose" reads "Tap to choose an image".
  const touch = useSyncExternalStore(() => () => {}, () => matchMedia('(hover: none)').matches, () => false);
  const text = touch ? label.replace(/^Drop (.+?) or click to choose$/, 'Tap to choose $1') : label;
  return (
    <div
      className={cx('tl-drop', over && 'over', compact && 'compact', error && 'err')}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current?.click())}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
    >
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <Icon name="upload" size={compact ? 16 : 20} />
      <div>
        <div className="tl-strong tl-small">{busy ? 'Uploading…' : text}</div>
        {hint && !compact && <div className="tl-tiny tl-muted">{hint}</div>}
      </div>
      {busy && <span className="dsweep" />}
    </div>
  );
}

/* ── Modal: focus moves in, Tab is trapped, Escape and the scrim close it ── */
export function Modal({ open, onClose, title, eyebrow, size = 'md', footer, children }: { open: boolean; onClose: () => void; title?: string; eyebrow?: string; size?: 'sm' | 'md' | 'lg'; footer?: React.ReactNode; children: React.ReactNode }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const last = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      const target = dialog.current?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), textarea, select') ?? dialog.current;
      target?.focus();
    }, 60);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prev;
      last?.focus?.();
    };
  }, [open]);
  if (!open || typeof document === 'undefined') return null;
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    if (e.key === 'Tab' && dialog.current) {
      const f = [...dialog.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  return createPortal(
    <div className="tl">
      <div className="tl-modal-root" onKeyDown={key}>
        <div className="scrim" onClick={onClose} />
        <div ref={dialog} className={cx('dialog', `s-${size}`)} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
          <header className="mh">
            <div>
              {eyebrow && <div className="tl-label">{eyebrow}</div>}
              {title && <h2 className="tl-h2">{title}</h2>}
            </div>
            <button className="x" type="button" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button>
          </header>
          <div className="mb">{children}</div>
          {footer && <footer className="mf">{footer}</footer>}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Counter: "54 / 65"; under the minimum amber, over the maximum red ── */
export function Counter({ value, min, max }: { value?: string | null; min?: number; max?: number }) {
  const n = (value ?? '').length;
  const tone = max !== undefined && n > max ? 'bad' : min !== undefined && n < min ? 'warn' : 'ok';
  return (
    <span className={cx('tl-counter tl-num', tone)} title={`${min ?? 0}–${max ?? '∞'} characters`}>
      {n}
      {max !== undefined && ` / ${max}`}
      {min !== undefined && n < min && ` · min ${min}`}
    </span>
  );
}

/* ── SerpPreview: a Google result as it will read, cut where Google cuts ── */
export function SerpPreview({ title, description, path, host = 'ascendpeptides.my' }: { title?: string | null; description?: string | null; path: string; host?: string }) {
  const crumbs = path.split('/').filter(Boolean).join(' › ');
  const t = title || 'Title missing';
  const d = description || 'Meta description missing: Google will pick text from the page.';
  return (
    <div className="tl-serp" aria-label="Search result preview">
      <div className="site">
        <span className="fav">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 18px favicon, as Google draws it */}
          <img src="/favicon.png" alt="" />
        </span>
        <span className="col">
          <span className="nm">Ascend MY</span>
          <span className="url">https://{host}{crumbs && ` › ${crumbs}`}</span>
        </span>
      </div>
      <div className={cx('t', !title && 'missing')}>{t.length > 62 ? `${t.slice(0, 60).trimEnd()}…` : t}</div>
      <div className={cx('d', !description && 'missing')}>{d.length > 158 ? `${d.slice(0, 156).trimEnd()}…` : d}</div>
    </div>
  );
}

/* ── DataTable: hairline rows, row click navigates, an arrow slides in on hover; folds into cards on phones ── */
export type Column<T> = { key: string; label: string; width?: string; align?: 'left' | 'right'; hideSm?: boolean; sm?: 'main' | 'end' | 'end2' | 'hide'; cell: (row: T) => React.ReactNode };
export function DataTable<T extends { id: string }>({ columns, rows, loading, onRowClick, empty }: { columns: Column<T>[]; rows: T[]; loading?: boolean; onRowClick?: (r: T) => void; empty?: React.ReactNode }) {
  return (
    <div className="tl-table">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align ?? 'left' }} className={cx(c.hideSm && 'hide-sm')}>{c.label}</th>
            ))}
            {onRowClick && <th className="arrow-col" aria-hidden />}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>{columns.map((c) => <td key={c.key}><div className="skel" style={{ width: c.key === columns[0].key ? '60%' : '50%' }} /></td>)}</tr>
              ))
            : rows.map((r) => (
                <tr
                  key={r.id}
                  className={cx(onRowClick && 'clickable')}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={() => onRowClick?.(r)}
                  onKeyDown={(e) => e.key === 'Enter' && onRowClick?.(r)}
                >
                  {columns.map((c, i) => (
                    <td key={c.key} style={{ textAlign: c.align ?? 'left' }} className={cx(c.hideSm && 'hide-sm', `m-${c.sm ?? (i === 0 ? 'main' : 'hide')}`)}>{c.cell(r)}</td>
                  ))}
                  {onRowClick && <td className="arrow-col"><Icon name="arrow" size={15} className="go" /></td>}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && rows.length === 0 && empty}
    </div>
  );
}

/* ── toasts: ok('Draft saved', 'Not live until the next publish.') / fail(err, 'Not saved') ── */
type Toast = { id: number; title: string; body?: string; tone: 'ok' | 'bad' };
let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function push(t: Omit<Toast, 'id'>) {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { ...t, id }];
  emit();
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== id); emit(); }, t.tone === 'bad' ? 6000 : 3500);
}
export const ok = (title: string, body?: string) => push({ title, body, tone: 'ok' });
export function fail(e: unknown, title: string) {
  const data = (e as { response?: { data?: { error?: string; details?: { path: string; message: string }[] } } })?.response?.data;
  const body = data?.details?.length ? data.details.map((d) => d.message).slice(0, 3).join(' ') : data?.error ?? (e as Error)?.message;
  push({ title, body, tone: 'bad' });
}
export function Toasts() {
  const list = useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => toasts, () => toasts);
  if (!list.length) return null;
  return (
    <div className="tl-toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cx('tl-toast', t.tone)}>
          <div className="tt">{t.title}</div>
          {t.body && <div className="tb">{t.body}</div>}
        </div>
      ))}
    </div>
  );
}
