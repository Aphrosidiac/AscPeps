'use client';

// Teliti's MarkdownEditor (a plain textarea, so every native editing key works; a small toolbar that
// wraps the selection; ⌘B / ⌘I / ⌘K; product cards from the catalogue; Write / Preview), plus Ascend's
// one addition: photos placed anywhere in the text, mid-sentence included.
//
// A photo is `{{image:<id>}}` in the text. Put one in by:
//  - the Photo button (uploads, then places it at the cursor),
//  - pasting an image, or dropping an image file on the text (it lands where you drop it),
//  - dragging a photo's thumbnail from the list below onto the text (moves it if it is already placed).
// Each photo's alt text, caption and credit are edited in the list; Replace swaps the file and keeps
// its place; Remove takes it out of the text and the article.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Counter, Field, Icon, Modal, Segmented } from '@/components/admin/tl/kit';
import { IMAGE_TOKEN, renderResearchBody, type EmbedProduct } from '@/lib/research-markdown';
import { LIMITS } from '@/lib/research-admin';
import type { ResearchImage } from '@/types';

const DRAG_TYPE = 'application/x-research-image';
const tokenFor = (id: string) => `{{image:${id}}}`;

/** Where in a textarea's text a screen point falls: a hidden copy of the textarea with the same
 *  metrics is hit-tested, since a textarea exposes no caret-from-point of its own. */
function caretFromPoint(ta: HTMLTextAreaElement, x: number, y: number): number {
  const cs = getComputedStyle(ta);
  const r = ta.getBoundingClientRect();
  const m = document.createElement('div');
  for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'textTransform', 'tabSize', 'textIndent'] as const) {
    (m.style as unknown as Record<string, string>)[p] = cs[p];
  }
  Object.assign(m.style, {
    position: 'fixed', left: `${r.left}px`, top: `${r.top - ta.scrollTop}px`, width: `${r.width}px`, minHeight: `${r.height}px`,
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', borderStyle: 'solid', borderColor: 'transparent',
    opacity: '0', zIndex: '2147483647', pointerEvents: 'auto',
  });
  m.textContent = `${ta.value}​`;
  document.body.appendChild(m);
  let at = ta.value.length;
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const pos = d.caretPositionFromPoint?.(x, y);
  if (pos && pos.offsetNode === m.firstChild) at = pos.offset;
  else {
    const rg = d.caretRangeFromPoint?.(x, y);
    if (rg && rg.startContainer === m.firstChild) at = rg.startOffset;
  }
  m.remove();
  return Math.min(at, ta.value.length);
}

export interface BodyEditorProps {
  value: string;
  onChange: (v: string) => void;
  images: ResearchImage[];
  products: EmbedProduct[];
  onPickProduct: () => void;
  /** Uploads a file and creates the photo (the article is saved first if it is new). */
  addPhoto: (file: File) => Promise<ResearchImage | null>;
  updatePhoto: (id: string, patch: Partial<ResearchImage>) => void;
  replacePhoto: (id: string, file: File) => Promise<void>;
  removePhoto: (id: string) => Promise<void>;
  error?: string | null;
  photoErrors: Record<string, string>;
  /** Product card insert hook (the parent's picker calls this with the token). */
  insertRef: React.MutableRefObject<((block: string) => void) | null>;
}

export function BodyEditor({ value, onChange, images, products, onPickProduct, addPhoto, updatePhoto, replacePhoto, removePhoto, error, photoErrors, insertRef }: BodyEditorProps) {
  const [mode, setMode] = useState<'write' | 'split' | 'preview'>('write');
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dropOn, setDropOn] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ResearchImage | null>(null);
  const caret = useRef<{ a: number; b: number }>({ a: value.length, b: value.length });

  const remember = () => {
    const el = ta.current;
    if (el && document.activeElement === el) caret.current = { a: el.selectionStart, b: el.selectionEnd };
  };
  const focusAt = (a: number, b = a) =>
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(a, b);
      caret.current = { a, b };
    });

  function wrap(before: string, after = before, placeholder = 'text') {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const s = value.slice(a, b) || placeholder;
    onChange(value.slice(0, a) + before + s + after + value.slice(b));
    focusAt(a + before.length, a + before.length + s.length);
  }
  function linePrefix(prefix: string) {
    const el = ta.current;
    if (!el) return;
    const a = el.selectionStart;
    const start = value.lastIndexOf('\n', a - 1) + 1;
    onChange(value.slice(0, start) + prefix + value.slice(start));
    focusAt(a + prefix.length);
  }
  /** A block (a product card) on its own lines at the caret. */
  function insertBlock(text: string) {
    const a = caret.current.a;
    const pre = a > 0 && value[a - 1] !== '\n' ? '\n\n' : value[a - 2] === '\n' || a === 0 ? '' : '\n';
    const post = value[a] && value[a] !== '\n' ? '\n\n' : '\n';
    onChange(value.slice(0, a) + pre + text + post + value.slice(a));
    setMode((m) => (m === 'preview' ? 'write' : m));
    focusAt(a + pre.length + text.length + post.length);
  }
  useEffect(() => {
    insertRef.current = insertBlock;
  });

  /** A photo inline at a position: mid-sentence is fine. Moving one takes it out of its old place. */
  function place(id: string, at: number, text = value) {
    let v = text;
    let pos = at;
    const tok = tokenFor(id);
    for (let i = v.indexOf(tok); i !== -1; i = v.indexOf(tok)) {
      v = v.slice(0, i) + v.slice(i + tok.length);
      if (i < pos) pos -= Math.min(tok.length, pos - i);
    }
    onChange(v.slice(0, pos) + tok + v.slice(pos));
    setSel(id);
    setMode((m) => (m === 'preview' ? 'split' : m));
    focusAt(pos + tok.length);
  }

  async function uploadAndPlace(file: File, at: number) {
    if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type)) return;
    setBusy(true);
    try {
      const im = await addPhoto(file);
      if (im) place(im.id, at);
    } finally {
      setBusy(false);
    }
  }

  function findInText(id: string) {
    const i = value.indexOf(tokenFor(id));
    setSel(id);
    if (i === -1) return;
    if (mode === 'preview') setMode('split');
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(i, i + tokenFor(id).length);
      // a textarea scrolls the selection into view only on some browsers: nudge the page there
      const lines = value.slice(0, i).split('\n').length;
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 21;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + lines * lh - window.innerHeight / 3, behavior: 'smooth' });
    });
  }

  function key(e: React.KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === 'b') { e.preventDefault(); wrap('**'); }
    else if (e.key === 'i') { e.preventDefault(); wrap('_'); }
    else if (e.key === 'k') { e.preventDefault(); e.stopPropagation(); wrap('[', '](/path)', 'link text'); }
  }

  const html = useMemo(() => renderResearchBody(value, { images, products, showMissing: true }), [value, images, products]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of value.matchAll(IMAGE_TOKEN)) c[m[1]] = (c[m[1]] ?? 0) + 1;
    return c;
  }, [value]);
  const cardCount = (value.match(/^\{\{product:[^}]+\}\}$/gm) ?? []).length;

  const textarea = (
    <textarea
      ref={ta}
      data-field="body"
      className={`tl-textarea mono-ish${dropOn ? ' drop-on' : ''}`}
      rows={14}
      value={value}
      spellCheck
      placeholder={'## The question, as people ask it\n\nThe answer, every finding tied to a study in Cited studies below.'}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={key}
      onSelect={remember}
      onKeyUp={remember}
      onMouseUp={remember}
      onPaste={(e) => {
        const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
        if (!f) return;
        e.preventDefault();
        void uploadAndPlace(f, e.currentTarget.selectionStart);
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE) || e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropOn(true);
        }
      }}
      onDragLeave={() => setDropOn(false)}
      onDrop={(e) => {
        setDropOn(false);
        const id = e.dataTransfer.getData(DRAG_TYPE);
        const file = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
        if (!id && !file) return;
        e.preventDefault();
        const at = caretFromPoint(e.currentTarget, e.clientX, e.clientY);
        if (id) place(id, at);
        else if (file) void uploadAndPlace(file, at);
      }}
    />
  );
  const preview = (
    <div
      className="rs tl-panel tl-md-preview"
      onClick={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>('[data-image]');
        if (el) { e.preventDefault(); findInText(el.dataset.image!); }
      }}
    >
      <div className="rs-prose" dangerouslySetInnerHTML={{ __html: html || '<p style="color:#6e6e6e">Nothing written yet.</p>' }} />
    </div>
  );

  return (
    <Field data-field="body" label="Body" required error={error} hint="Markdown. ## headings become the “On this page” list. Every finding cites a study listed in Cited studies. Product cards render from the catalogue; photos can sit anywhere, mid-sentence included.">
      <div className="tl-md">
        <div className="bar">
          <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'write', label: 'Write' }, { value: 'split', label: 'Side by side' }, { value: 'preview', label: 'Preview' }]} />
          {mode !== 'preview' && (
            <div className="tools">
              <button type="button" title="Heading (##)" onClick={() => linePrefix('## ')}><span className="hx">H2</span></button>
              <button type="button" title="Bold (⌘B)" onClick={() => wrap('**')}><b>B</b></button>
              <button type="button" title="Italic (⌘I)" onClick={() => wrap('_')}><i>I</i></button>
              <button type="button" title="Link (⌘K)" onClick={() => wrap('[', '](/path)', 'link text')}><Icon name="link" size={14} /></button>
              <button type="button" title="List" onClick={() => linePrefix('- ')}><Icon name="list" size={14} /></button>
              <button type="button" className="card-btn" onClick={() => { remember(); onPickProduct(); }}><Icon name="vial" size={14} /><span>Product card</span></button>
              <button type="button" className="card-btn" title="Upload a photo and place it at the cursor" onClick={() => { remember(); fileIn.current?.click(); }}>
                <Icon name="image" size={14} /><span>{busy ? 'Uploading…' : 'Photo'}</span>
              </button>
            </div>
          )}
          <span className="tl-tiny tl-muted">
            {[cardCount && `${cardCount} card${cardCount === 1 ? '' : 's'}`, images.length > 0 && `${images.length} photo${images.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
          </span>
          <input ref={fileIn} type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAndPlace(f, caret.current.a); e.target.value = ''; }} />
        </div>
        {mode === 'write' && textarea}
        {mode === 'preview' && preview}
        {mode === 'split' && <div className="split">{textarea}{preview}</div>}

        <div className="tl-photos mt-3" data-field="images">
          {images.length > 0 && <div className="tl-label">Photos in this article</div>}
          {images.map((im) => (
            <PhotoCard
              key={im.id}
              image={im}
              placed={counts[im.id] ?? 0}
              selected={sel === im.id}
              errors={photoErrors}
              onSelect={() => setSel(im.id)}
              onPlace={() => place(im.id, caret.current.a)}
              onFind={() => findInText(im.id)}
              onChange={(patch) => updatePhoto(im.id, patch)}
              onReplace={(f) => replacePhoto(im.id, f)}
              onRemove={() => setRemoving(im)}
            />
          ))}
          {images.length === 0 && (
            <p className="tl-tiny tl-muted">No photos yet. Use Photo, paste an image, or drop one on the text where it should sit.</p>
          )}
        </div>
      </div>
      <Modal
        open={!!removing}
        onClose={() => setRemoving(null)}
        eyebrow="Photo"
        title="Remove this photo?"
        size="sm"
        footer={
          <>
            <Btn variant="subtle" onClick={() => setRemoving(null)}>Cancel</Btn>
            <Btn
              variant="danger"
              icon="trash"
              onClick={async () => {
                const im = removing!;
                setRemoving(null);
                onChange(value.split(tokenFor(im.id)).join(''));
                await removePhoto(im.id);
              }}
            >
              Remove photo
            </Btn>
          </>
        }
      >
        <p className="tl-small tl-muted">
          {counts[removing?.id ?? ''] ? 'It comes out of the text and the article. ' : 'It is not placed in the text. '}
          A live article keeps showing it until you publish again.
        </p>
      </Modal>
    </Field>
  );
}

function PhotoCard({ image: im, placed, selected, errors, onSelect, onPlace, onFind, onChange, onReplace, onRemove }: {
  image: ResearchImage; placed: number; selected: boolean; errors: Record<string, string>;
  onSelect: () => void; onPlace: () => void; onFind: () => void; onChange: (p: Partial<ResearchImage>) => void; onReplace: (f: File) => Promise<void>; onRemove: () => void;
}) {
  const [alt, setAlt] = useState(im.alt);
  const [caption, setCaption] = useState(im.caption ?? '');
  const [credit, setCredit] = useState(im.credit ?? '');
  const [creditUrl, setCreditUrl] = useState(im.creditUrl ?? '');
  const [replacing, setReplacing] = useState(false);
  const rep = useRef<HTMLInputElement>(null);
  const [amin, amax] = LIMITS.alt;
  const altErr = errors[`images.${im.id}.alt`] ?? (alt.length > amax ? 'Too long: 160 characters max.' : null);
  const commit = (patch: Partial<ResearchImage>) => onChange(patch);
  return (
    <div className={`tl-photo${selected ? ' sel' : ''}`} data-field={`images.${im.id}`} onFocusCapture={onSelect}>
      <div>
        <div
          className="pthumb"
          draggable
          title="Drag onto the text to place it there"
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_TYPE, im.id);
            e.dataTransfer.setData('text/plain', tokenFor(im.id));
            e.dataTransfer.effectAllowed = 'move';
          }}
          onClick={onFind}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={im.url} alt="" />
        </div>
        <div className="tl-tiny tl-muted mt-2">{im.width}×{im.height}</div>
        <div className={`tl-tiny mt-2 ${placed ? 'tl-good' : 'tl-warn'}`}>{placed ? (placed > 1 ? `Placed ${placed}×` : 'Placed') : 'Not placed'}</div>
      </div>
      <div className="tl-grid gap-2">
        <Field label="Alt text" required error={altErr} hint="What the photo shows, for screen readers and image search.">
          <input className="tl-input" value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} onBlur={() => alt !== im.alt && commit({ alt })} />
          <div className="tl-under"><Counter value={alt} min={amin} max={amax} /></div>
        </Field>
        <div className="tl-grid-2">
          <Field label="Caption" hint="Printed under the photo.">
            <input className="tl-input" value={caption} maxLength={500} onChange={(e) => setCaption(e.target.value)} onBlur={() => caption !== (im.caption ?? '') && commit({ caption: caption || null })} />
          </Field>
          <Field label="Credit" hint="e.g. Adapted from Doe et al. 2025 (CC BY 4.0)">
            <input className="tl-input" value={credit} maxLength={300} onChange={(e) => setCredit(e.target.value)} onBlur={() => credit !== (im.credit ?? '') && commit({ credit: credit || null })} />
          </Field>
        </div>
        {credit && (
          <Field label="Credit link">
            <input className="tl-input" value={creditUrl} placeholder="https://" onChange={(e) => setCreditUrl(e.target.value)} onBlur={() => creditUrl !== (im.creditUrl ?? '') && commit({ creditUrl: creditUrl || null })} />
          </Field>
        )}
        <div className="acts">
          <Btn size="sm" variant="ghost" icon="arrow" onClick={onPlace} title="Put it where the cursor is in the text">{placed ? 'Move to cursor' : 'Place at cursor'}</Btn>
          {placed > 0 && <Btn size="sm" variant="subtle" icon="search" onClick={onFind}>Find in text</Btn>}
          <Btn size="sm" variant="subtle" icon="replace" loading={replacing} onClick={() => rep.current?.click()}>Replace</Btn>
          <Btn size="sm" variant="subtle" icon="trash" onClick={onRemove}>Remove</Btn>
          <input ref={rep} type="file" accept="image/jpeg,image/png,image/webp,image/avif" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setReplacing(true); try { await onReplace(f); } finally { setReplacing(false); } }} />
        </div>
      </div>
    </div>
  );
}

