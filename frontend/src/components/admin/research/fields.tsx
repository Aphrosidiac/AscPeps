'use client';

// Teliti's edit components (AscComp apps/admin/src/components/edit), ported to React:
// LockedPath, DeleteDecision, SeoFields, ImageField, MultiPick and ProductCardPicker.

import { useMemo, useState } from 'react';
import { Btn, Counter, Field, FileDrop, Icon, Modal, Segmented, SerpPreview, fail, ok } from '@/components/admin/tl/kit';
import { checkSlug, errAt, LIMITS, type Errors } from '@/lib/research-admin';
import { formatPrice, getDefaultVariant } from '@/lib/utils';
import type { Product } from '@/types';

/* ── LockedPath: a slug that locks at the first publish; after that "Rename…" records a 301 ── */
export function LockedPath({ value, onChange, prefix, locked, error, rename }: { value: string; onChange: (v: string) => void; prefix: string; locked: boolean; error?: string | null; rename?: (v: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const nextErr = checkSlug(next) ?? (next === value ? 'Same as now' : null);
  async function go() {
    if (!rename || nextErr) return;
    setBusy(true);
    try {
      await rename(next);
      setOpen(false);
      ok('Renamed', 'The old URL now answers with a 301 to the new one.');
    } catch (e) {
      fail(e, 'Not renamed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Field
        data-field="slug"
        label="Slug"
        required
        error={error}
        hint={locked ? 'Locked since the first publish. Renaming creates a 301 from the published URL.' : 'Lowercase-hyphenated. Locks at the first publish.'}
      >
        <div className="tl-row gap-2 tl-slug-row">
          <div className={`tl-slug tl-input${locked ? ' locked' : ''}`}>
            <span className="pre">{prefix}</span>
            <input value={value} disabled={locked} spellCheck={false} onChange={(e) => onChange(e.target.value)} />
            {locked && <Icon name="lock" size={14} />}
          </div>
          {locked && rename && (
            <Btn variant="ghost" icon="link" onClick={() => { setNext(value); setOpen(true); }}>Rename…</Btn>
          )}
        </div>
      </Field>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        eyebrow="URL is locked"
        title="Rename and redirect"
        size="sm"
        footer={
          <>
            <Btn variant="subtle" onClick={() => setOpen(false)}>Cancel</Btn>
            <Btn variant="primary" icon="link" loading={busy} disabled={!!nextErr} onClick={go}>Rename with 301</Btn>
          </>
        }
      >
        <p className="tl-small tl-muted">The published URL keeps answering: from now on it sends visitors and Google, with a 301, to the new one.</p>
        <Field className="mt-4" label="New slug" error={nextErr}>
          <div className="tl-slug tl-input">
            <span className="pre">{prefix}</span>
            <input value={next} autoFocus spellCheck={false} onChange={(e) => setNext(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
          </div>
        </Field>
      </Modal>
    </>
  );
}

/* ── DeleteDecision: once a URL has been published it either 301s or is gone. No third option. ── */
export type Target = { value: string; label: string; sub?: string };
type DeleteProps = { open: boolean; onClose: () => void; what: string; path: string; published: boolean; targets: Target[]; busy?: boolean; onConfirm: (d: { redirectTo: string } | { gone: true } | undefined) => void };
export function DeleteDecision(props: DeleteProps) {
  // Mounted only while open, so every opening starts from "Redirect" with nothing chosen.
  return props.open ? <DeleteDialog {...props} /> : null;
}
function DeleteDialog({ open, onClose, what, path, published, targets, busy, onConfirm }: DeleteProps) {
  const [mode, setMode] = useState<'redirect' | 'gone'>('redirect');
  const [to, setTo] = useState('');
  const ready = !published || mode === 'gone' || !!to;
  const go = () => onConfirm(!published ? undefined : mode === 'gone' ? { gone: true } : { redirectTo: to });
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={published ? 'Published URL' : 'Draft'}
      title={`Delete ${what}?`}
      size="md"
      footer={
        <>
          <Btn variant="subtle" onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" icon="trash" disabled={!ready} loading={busy} onClick={go}>
            {!published ? 'Delete draft' : mode === 'gone' ? 'Delete and mark gone' : 'Delete and redirect'}
          </Btn>
        </>
      }
    >
      {published ? (
        <>
          <p className="tl-muted"><span className="tl-code">{path}</span> has been live, so Google knows it. Choose what it does from now on.</p>
          <div className="mt-4">
            <Segmented value={mode} onChange={setMode} options={[{ value: 'redirect', label: 'Redirect (301)', icon: 'link' }, { value: 'gone', label: 'Gone', icon: 'gone' }]} />
          </div>
          {mode === 'redirect' ? (
            <Field className="mt-4" label="Send visitors to" hint="One hop, never to the homepage. Pick the closest live replacement.">
              <select className="tl-select" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose a live page…</option>
                {targets.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}{t.sub && t.sub !== t.label ? ` (${t.sub})` : ''}</option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="tl-small tl-muted mt-4">The URL stops answering and drops out of the index. Use it when nothing on the site replaces it.</p>
          )}
        </>
      ) : (
        <p className="tl-muted">It has never been published, so no URL needs a decision. The draft is removed.</p>
      )}
    </Modal>
  );
}

/* ── SeoFields: title + meta description with live counters and the search preview ── */
export function SeoFields({ title, description, onTitle, onDescription, path, errors, formula }: { title: string; description: string; onTitle: (v: string) => void; onDescription: (v: string) => void; path: string; errors: Errors; formula?: string | null }) {
  const [tmin, tmax] = LIMITS['seo.title'];
  const [dmin, dmax] = LIMITS['seo.description'];
  return (
    <div className="tl-grid" data-field="seo">
      <Field data-field="seo.title" label="SEO title" error={errAt(errors, 'seo.title')} hint={`${tmin}–${tmax} characters, unique across the site.`}>
        <input className="tl-input" value={title} maxLength={90} onChange={(e) => onTitle(e.target.value)} />
        <div className="tl-under">
          <Counter value={title} min={tmin} max={tmax} />
          {formula && formula !== title && (
            <button type="button" className="tl-link tl-small" onClick={() => onTitle(formula)}>Use the H1</button>
          )}
        </div>
      </Field>
      <Field data-field="seo.description" label="Meta description" error={errAt(errors, 'seo.description')} hint={`${dmin}–${dmax} characters. Say what it is, who it is for, and one reason to click.`}>
        <textarea className="tl-textarea" rows={3} maxLength={240} value={description} onChange={(e) => onDescription(e.target.value)} style={{ fieldSizing: 'content' } as React.CSSProperties} />
        <div className="tl-under"><Counter value={description} min={dmin} max={dmax} /></div>
      </Field>
      <div>
        <div className="tl-label mb-2">Search preview</div>
        <SerpPreview title={title} description={description} path={path} />
      </div>
    </div>
  );
}

/* ── ImageField: the lead image. Alt text is required. ── */
export function ImageField({ url, alt, width, height, onAlt, onUpload, onRemove, busy, error, altDefault, hint, label = 'Lead image', required }: { url: string | null; alt: string; width: number | null; height: number | null; onAlt: (v: string) => void; onUpload: (f: File) => void; onRemove: () => void; busy?: boolean; error?: string | null; altDefault?: string; hint?: string; label?: string; required?: boolean }) {
  const [amin, amax] = LIMITS.alt;
  const altErr = alt.length < amin ? 'Alt text is required (10–160 characters).' : alt.length > amax ? 'Too long: 160 characters max.' : null;
  return (
    <Field data-field="leadImage" label={label} required={required} error={url ? null : error} hint={url || !error ? hint : undefined}>
      {url ? (
        <div className="tl-imgf">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <div className="tl-thumb"><img src={url} alt={alt} /></div>
          <div className="tl-grid gap-2 tl-grow">
            <div className="tl-row gap-2 wrap">
              <span className="tl-code">{url.split('/').pop()}</span>
              {width && <span className="tl-tiny tl-muted">{width}×{height}</span>}
            </div>
            <Field data-field="leadImage.alt" label="Alt text" error={altErr}>
              <textarea className="tl-textarea" rows={2} value={alt} onChange={(e) => onAlt(e.target.value)} style={{ minHeight: 64, fieldSizing: 'content' } as React.CSSProperties} />
              <div className="tl-row between mt-2">
                <Counter value={alt} min={amin} max={amax} />
                {altDefault && <button type="button" className="tl-link tl-small" onClick={() => onAlt(altDefault)}>Use template</button>}
              </div>
            </Field>
            <div className="tl-row gap-2">
              <FileDrop compact accept="image/jpeg,image/png,image/webp,image/avif" busy={busy} label="Replace: drop an image or click to choose" onFile={onUpload} />
              <Btn size="sm" variant="subtle" icon="trash" onClick={onRemove}>Remove</Btn>
            </div>
          </div>
        </div>
      ) : (
        <div className="tl-grid gap-3">
          <FileDrop accept="image/jpeg,image/png,image/webp,image/avif" busy={busy} label="Drop an image or click to choose" hint="JPEG, PNG, WebP or AVIF. Stored as WebP, up to 1600 px wide." error={!!error} onFile={onUpload} />
          {error && <div className="tl-err-msg">{error === 'Required.' ? 'Add an image.' : error}</div>}
        </div>
      )}
    </Field>
  );
}

/* ── MultiPick: chosen values as chips (ordered: move left/right), then a select to add one more ── */
export function MultiPick({ value, onChange, options, placeholder = 'Add…', ordered }: { value: string[]; onChange: (v: string[]) => void; options: { value: string; label: string }[]; placeholder?: string; ordered?: boolean }) {
  const label = (v: string) => options.find((o) => o.value === v)?.label ?? v;
  const left = options.filter((o) => !value.includes(o.value));
  const move = (i: number, d: -1 | 1) => {
    const a = [...value];
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    onChange(a);
  };
  return (
    <div className="tl-mp">
      {value.length > 0 && (
        <div className="tl-chips">
          {value.map((v, i) => (
            <span key={v} className="tl-pick">
              {ordered && <span className="ord tl-num">{i + 1}</span>}
              <span className="tl-ellipsis">{label(v)}</span>
              {ordered && i > 0 && <button type="button" className="b" aria-label={`Move ${label(v)} earlier`} onClick={() => move(i, -1)}><Icon name="chevron-left" size={12} /></button>}
              {ordered && i < value.length - 1 && <button type="button" className="b" aria-label={`Move ${label(v)} later`} onClick={() => move(i, 1)}><Icon name="chevron" size={12} /></button>}
              <button type="button" className="b" aria-label={`Remove ${label(v)}`} onClick={() => onChange(value.filter((x) => x !== v))}><Icon name="close" size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <select className="tl-select sm" value="" disabled={!left.length} onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
        <option value="">{left.length ? placeholder : 'All added'}</option>
        {left.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

/* ── ProductCardPicker: pick a compound; the card renders from the catalogue, nothing typed by hand ── */
type PickerProps = { open: boolean; onClose: () => void; products: Product[] | null; onPick: (id: string) => void };
export function ProductCardPicker(props: PickerProps) {
  return props.open ? <PickerDialog {...props} /> : null;
}
function PickerDialog({ open, onClose, products, onPick }: PickerProps) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const shown = useMemo(
    () => (products ?? []).filter((p) => `${p.name} /products/${p.slug} ${p.id}`.toLowerCase().includes(q.trim().toLowerCase())),
    [products, q]
  );
  const pick = (i: number) => {
    const p = shown[i];
    if (!p) return;
    onPick(p.id);
    onClose();
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(shown.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(active); }
  };
  return (
    <Modal open={open} onClose={onClose} eyebrow="Insert product card" title="Which compound?" size="md">
      <label className="tl-search" style={{ width: '100%', marginLeft: 0 }}>
        <Icon name="search" size={15} />
        <input value={q} autoFocus placeholder="Search compounds" onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={key} />
      </label>
      <ul className="tl-opts" role="listbox">
        {shown.map((p, i) => {
          const v = getDefaultVariant(p);
          const price = v ? formatPrice(v.price) : 'no price';
          return (
            <li key={p.id} role="option" aria-selected={i === active} className={i === active ? 'act' : ''} onMouseEnter={() => setActive(i)} onClick={() => pick(i)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {v?.imageUrl ? <img src={v.imageUrl} alt="" className="th" loading="lazy" /> : <span className="th" />}
              <span className="tl-grow">
                <span className="tl-strong">{p.name}</span>
                <span className="tl-tiny tl-muted" style={{ display: 'block' }}>{price} · /products/{p.slug}</span>
              </span>
              <span className="tl-code tl-muted no-phone">{`{{product:${p.id}}}`}</span>
            </li>
          );
        })}
        {!shown.length && <li className="tl-muted tl-small none">{products === null ? 'Loading compounds…' : 'No compound matches.'}</li>}
      </ul>
    </Modal>
  );
}
