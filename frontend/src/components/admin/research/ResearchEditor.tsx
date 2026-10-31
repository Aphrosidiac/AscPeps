'use client';

// Teliti's PostEditor (views/PostEditor.vue) on its EditorFrame and RecordSide, for Ascend's
// research summaries. Saving writes a DRAFT; nothing reaches /research until Publish.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import {
  adminAddResearchImage, adminCreateResearch, adminDeleteResearch, adminDeleteResearchImage, adminGetProducts, adminGetResearch,
  adminGetResearchAuthors, adminGetResearchTargets, adminPublishResearch, adminRenameResearch, adminUnpublishResearch,
  adminUpdateResearch, adminUpdateResearchImage, adminUploadImage, type ResearchAuthorRow, type ResearchTarget,
} from '@/lib/api';
import { contractCheck, date, errAt, jumpToField, LIMITS, slugify, type Errors } from '@/lib/research-admin';
import { formatPrice, getDefaultVariant } from '@/lib/utils';
import { Btn, Chip, Counter, Field, Hint, Icon, Modal, PageHeader, TlRoot, Toasts, Toggle, fail, ok } from '@/components/admin/tl/kit';
import { DeleteDecision, ImageField, LockedPath, MultiPick, ProductCardPicker, SeoFields } from '@/components/admin/research/fields';
import { BodyEditor } from '@/components/admin/research/BodyEditor';
import { CitationsField } from '@/components/admin/research/sources';
import type { EmbedProduct } from '@/lib/research-markdown';
import type { Product, ResearchDraft, ResearchImage } from '@/types';
import '@/app/research/research.css';

const today = () => new Date().toISOString().slice(0, 10);
const blank = (): ResearchDraft => ({
  id: '', slug: '', title: '', dek: '', body: '', seoTitle: '', seoDescription: '',
  leadImageUrl: null, leadImageAlt: '', leadImageWidth: null, leadImageHeight: null,
  relatedProductIds: [], author: null, reviewer: null, authorId: null, reviewerId: null,
  citations: [], images: [], datePublished: null, liveAt: null, slugLockedAt: null,
  publishState: 'draft', livePath: null, issues: [], path: '/research/', createdAt: '', updatedAt: '',
});

/** The fields a save sends. Photos are saved as they change; people come back resolved. */
const payload = (d: ResearchDraft) => ({
  title: d.title, ...(d.slugLockedAt ? {} : { slug: d.slug }), dek: d.dek, body: d.body, seoTitle: d.seoTitle, seoDescription: d.seoDescription,
  leadImageUrl: d.leadImageUrl, leadImageAlt: d.leadImageAlt, leadImageWidth: d.leadImageWidth, leadImageHeight: d.leadImageHeight,
  authorId: d.authorId, reviewerId: d.reviewerId, datePublished: d.datePublished, relatedProductIds: d.relatedProductIds,
  citations: d.citations.map((c) => ({ sourceId: c.sourceId, finding: c.finding })),
});
const snap = (d: ResearchDraft | null) => (d ? JSON.stringify(payload(d)) : '');

function toEmbed(p: Product): EmbedProduct {
  const active = p.variants.filter((v) => v.active);
  const prices = active.map((v) => v.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return {
    id: p.id, name: p.name, slug: p.slug, imageUrl: getDefaultVariant(p)?.imageUrl ?? null,
    sizes: active.map((v) => v.size).filter(Boolean).join(' · '),
    price: prices.length === 0 ? '' : lo === hi ? formatPrice(lo) : `${formatPrice(lo)}–${formatPrice(hi).replace(/^RM\s?/, '')}`,
  };
}

export function ResearchEditor({ id }: { id: string }) {
  const router = useRouter();
  const { token } = useAuth();
  const [draft, setDraft] = useState<ResearchDraft | null>(null);
  // /admin/research/new until the first save creates the article.
  const isNew = id === 'new' && !draft?.id;
  // The last saved copy: Discard returns to it, and `dirty` compares against it.
  const [savedDraft, setSavedDraft] = useState<ResearchDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [people, setPeople] = useState<ResearchAuthorRow[]>([]);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [targets, setTargets] = useState<ResearchTarget[]>([]);
  const [picker, setPicker] = useState(false);
  const [leadBusy, setLeadBusy] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const touched = useRef(false);
  const insertBlock = useRef<((block: string) => void) | null>(null);

  const dirty = !!draft && snap(draft) !== snap(savedDraft);
  const set = useCallback(<K extends keyof ResearchDraft>(k: K, v: ResearchDraft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d)), []);
  /** Take a server copy as the saved state, keeping unsaved edits if there are any. */
  const absorb = useCallback((r: ResearchDraft, keepEdits: boolean) => {
    setDraft((d) => (keepEdits && d ? { ...r, ...payloadFields(d), images: r.images } : r));
    setSavedDraft(r);
  }, []);

  useEffect(() => {
    if (!token) return;
    // Just created here (the URL moved from /new to the id): what is in hand is current.
    (id === 'new' ? Promise.resolve(blank()) : adminGetResearch(token, id))
      .then((d) => { setDraft(d); setSavedDraft(d); })
      .catch(() => setError('Could not load this article.'))
      .finally(() => setLoading(false));
    adminGetResearchAuthors(token).then((r) => setPeople(r.data)).catch(() => undefined);
    adminGetProducts(token, { limit: '100' }).then((r: { data: Product[] }) => setProducts(r.data.filter((p) => p.active && !p.addOnOnly))).catch(() => setProducts([]));
  }, [token, id]);
  useEffect(() => {
    if (!token) return;
    adminGetResearchTargets(token)
      .then((r) => setTargets(r.data.filter((t) => t.id !== id)))
      .catch(() => undefined);
  }, [token, id]);

  // A new article's slug follows its H1 until someone edits the slug.
  const setTitle = (title: string) =>
    setDraft((d) => (d ? { ...d, title, ...(isNew && !touched.current ? { slug: slugify(title).slice(0, 70).replace(/-+$/, '') } : {}) } : d));

  const save = useCallback(async (): Promise<ResearchDraft | null> => {
    if (!token || !draft || saving) return null;
    setSaving(true);
    try {
      const r = draft.id ? await adminUpdateResearch(token, draft.id, payload(draft)) : await adminCreateResearch(token, payload(draft));
      // Edits made while the save was in flight stay; the photo list is the server's.
      setDraft((d) => (d && snap(d) !== snap(draft) ? { ...r, ...payloadFields(d), images: r.images } : r));
      setSavedDraft(r);
      setServerErrors({});
      if (!draft.id) {
        ok('Research article created', 'Saved as a draft. Publish when it is ready.');
        // The address moves to the article without remounting the editor: a photo being added
        // right now must land in this draft, not in one that is thrown away.
        window.history.replaceState(null, '', `/admin/research/${r.id}`);
      } else ok('Draft saved', r.publishState === 'live' ? 'The site already shows this.' : 'Not live until you publish.');
      return r;
    } catch (e) {
      const details = (e as { response?: { data?: { details?: { path: string; message: string }[] } } })?.response?.data?.details ?? [];
      setServerErrors(Object.fromEntries(details.map((d) => [d.path, d.message])));
      fail(e, 'Not saved');
      return null;
    } finally {
      setSaving(false);
    }
  }, [token, draft, saving]);

  // ⌘S saves; leaving with unsaved work asks first.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); if (dirty) void save(); }
    };
    const unload = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    const click = (e: MouseEvent) => {
      if (!dirty || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as HTMLElement).closest('a');
      const href = a?.getAttribute('href');
      if (!a || !href || !href.startsWith('/') || a.target === '_blank') return;
      e.preventDefault();
      setLeaveTo(href);
    };
    window.addEventListener('keydown', k);
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [dirty, save]);

  const errors = useMemo<Errors>(() => (draft ? { ...contractCheck(draft), ...serverErrors } : {}), [draft, serverErrors]);
  const e = (p: string) => errAt(errors, p);
  const prefix = '/research/';
  const embeds = useMemo(() => (products ?? []).map(toEmbed), [products]);

  /* photos: a new article is saved first, so a photo has an article to belong to */
  const ensureId = async () => draft?.id || (await save())?.id || null;
  async function upload(file: File) {
    if (!token) return null;
    try {
      return await adminUploadImage(token, file);
    } catch (err) {
      fail(err, 'Upload failed');
      return null;
    }
  }
  const addPhoto = async (file: File): Promise<ResearchImage | null> => {
    if (!token) return null;
    const articleId = await ensureId();
    if (!articleId) return null;
    const up = await upload(file);
    if (!up) return null;
    try {
      const im = await adminAddResearchImage(token, articleId, { url: up.url, width: up.width, height: up.height, alt: '', caption: null, credit: null, creditUrl: null });
      setDraft((d) => (d ? { ...d, images: [...d.images, im] } : d));
      return im;
    } catch (err) {
      fail(err, 'Photo not added');
      return null;
    }
  };
  const updatePhoto = async (imageId: string, patch: Partial<ResearchImage>) => {
    if (!token) return;
    try {
      const im = await adminUpdateResearchImage(token, imageId, patch);
      setDraft((d) => (d ? { ...d, images: d.images.map((x) => (x.id === imageId ? im : x)) } : d));
    } catch (err) {
      fail(err, 'Photo not saved');
    }
  };
  const replacePhoto = async (imageId: string, file: File) => {
    const up = await upload(file);
    if (up) await updatePhoto(imageId, { url: up.url, width: up.width, height: up.height });
  };
  const removePhoto = async (imageId: string) => {
    if (!token) return;
    try {
      await adminDeleteResearchImage(token, imageId);
      setDraft((d) => (d ? { ...d, images: d.images.filter((x) => x.id !== imageId) } : d));
      ok('Photo removed', 'Save the draft to keep the text without it.');
    } catch (err) {
      fail(err, 'Photo not removed');
    }
  };

  async function uploadLead(file: File) {
    setLeadBusy(true);
    const up = await upload(file);
    setLeadBusy(false);
    if (!up) return;
    setDraft((d) => (d ? { ...d, leadImageUrl: up.url, leadImageWidth: up.width, leadImageHeight: up.height, leadImageAlt: d.leadImageAlt || (d.title ? `Lead image for ${d.title}`.slice(0, 160) : '') } : d));
  }

  const rename = async (slug: string) => {
    if (!token || !draft?.id) return;
    const r = await adminRenameResearch(token, draft.id, slug);
    setDraft((d) => (d ? { ...d, slug: r.slug, path: r.path, livePath: r.livePath } : d));
    setSavedDraft((d) => (d ? { ...d, slug: r.slug, path: r.path, livePath: r.livePath } : d));
  };

  const peopleOptions = [{ value: '', label: 'Ascend MY editorial team (no person)' }, ...people.map((p) => ({ value: p.id, label: [p.name, [p.role, p.credentials].filter(Boolean).join(', ')].filter(Boolean).join(' · ') }))];

  return (
    <TlRoot>
      <div className="tl-editor">
        <PageHeader eyebrow="Content" title={draft?.title || (isNew ? 'New research article' : 'Research article')} back={{ to: '/admin/research', label: 'Research' }}>
          <span className="tl-code">{draft ? `${prefix}${draft.slug || 'slug'}` : ''}</span>
          {draft && <Chip status={draft.publishState} />}
          <Chip tone="muted">Research summary</Chip>
        </PageHeader>
        {error && <Hint icon="warn" tone="bad" text={error} />}
        <div className="tl-strip bare">
          <div className={`tl-save${dirty ? ' on' : ''}`}>
            {dirty && <span className="tl-tiny tl-muted no-phone">Unsaved draft</span>}
            {dirty && <Btn size="sm" variant="subtle" onClick={() => savedDraft && setDraft((d) => ({ ...savedDraft, images: d?.images ?? savedDraft.images }))}>Discard</Btn>}
            <Btn size="sm" variant="primary" icon="check" disabled={!dirty} loading={saving} onClick={() => void save()}>Save draft</Btn>
          </div>
        </div>
        {loading || !draft ? (
          <div className="tl-cols"><div className="tl-main">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="tl-skel" style={{ height: 56 }} />)}</div></div>
        ) : (
          <div className="tl-cols">
            <div className="tl-main">
              <div className="tl-grid-3">
                <Field data-field="datePublished" label="Published" error={e('datePublished')} hint={draft.slugLockedAt ? 'The date the byline prints.' : 'Empty = the day you first publish.'}>
                  <input className="tl-input" type="date" value={draft.datePublished?.slice(0, 10) ?? ''} max={today()} onChange={(ev) => set('datePublished', ev.target.value || null)} />
                </Field>
              </div>
              <Field data-field="h1" label="H1" required error={e('h1')} hint="10–90 characters. The question or claim as people search it.">
                <input className="tl-input" value={draft.title} onChange={(ev) => setTitle(ev.target.value)} />
                <div className="mt-2"><Counter value={draft.title} min={LIMITS.h1[0]} max={LIMITS.h1[1]} /></div>
              </Field>
              <LockedPath
                value={draft.slug}
                prefix={prefix}
                locked={!!draft.slugLockedAt}
                error={e('slug')}
                rename={draft.id ? rename : undefined}
                onChange={(v) => { touched.current = true; set('slug', v); }}
              />
              <Field data-field="dek" label="Dek" required error={e('dek')} hint="40–260 characters: the two-sentence answer first. It is the lede under the H1 and the line on /research.">
                <textarea className="tl-textarea" rows={2} style={{ minHeight: 64, fieldSizing: 'content' } as React.CSSProperties} value={draft.dek} onChange={(ev) => set('dek', ev.target.value)} />
                <div className="mt-2"><Counter value={draft.dek} min={LIMITS.dek[0]} max={LIMITS.dek[1]} /></div>
              </Field>
              <BodyEditor
                value={draft.body}
                onChange={(v) => set('body', v)}
                images={draft.images}
                products={embeds}
                onPickProduct={() => setPicker(true)}
                addPhoto={addPhoto}
                updatePhoto={updatePhoto}
                replacePhoto={replacePhoto}
                removePhoto={removePhoto}
                error={e('body')}
                photoErrors={errors}
                insertRef={insertBlock}
              />
              <ImageField
                url={draft.leadImageUrl}
                alt={draft.leadImageAlt}
                width={draft.leadImageWidth}
                height={draft.leadImageHeight}
                busy={leadBusy}
                error={e('leadImage')}
                required
                hint="16:9, at least 1600 px wide (Discover). The hero under the byline and the share image."
                altDefault={draft.title ? `Lead image for the research summary: ${draft.title}`.slice(0, 160) : undefined}
                onAlt={(v) => set('leadImageAlt', v)}
                onUpload={uploadLead}
                onRemove={() => setDraft((d) => (d ? { ...d, leadImageUrl: null, leadImageWidth: null, leadImageHeight: null } : d))}
              />
              <Field data-field="products" label="Compounds in this piece" hint="Cards after the body, in order, and the links between research and product pages. A compound already placed in the text as a card is not repeated.">
                <MultiPick ordered value={draft.relatedProductIds} onChange={(v) => set('relatedProductIds', v)} options={(products ?? []).map((p) => ({ value: p.id, label: p.name }))} placeholder="Add a compound" />
              </Field>
              <div className="tl-grid-2">
                <Field data-field="author" label="Written by" hint="People come from Writers & reviewers.">
                  <select className="tl-select" value={draft.authorId ?? ''} onChange={(ev) => set('authorId', ev.target.value || null)}>
                    {peopleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field data-field="reviewer" label="Reviewed by">
                  <select className="tl-select" value={draft.reviewerId ?? ''} onChange={(ev) => set('reviewerId', ev.target.value || null)}>
                    {[{ value: '', label: 'Not reviewed' }, ...peopleOptions.slice(1)].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              </div>
              <CitationsField value={draft.citations} onChange={(v) => set('citations', v)} errors={errors} error={errors.citations ?? null} />
              <SeoFields
                title={draft.seoTitle}
                description={draft.seoDescription}
                onTitle={(v) => set('seoTitle', v)}
                onDescription={(v) => set('seoDescription', v)}
                path={`${prefix}${draft.slug}`}
                errors={errors}
                formula={draft.title || null}
              />
            </div>
            <aside className="tl-side">
              <RecordSide
                draft={draft}
                dirty={dirty}
                errors={errors}
                targets={targets}
                onChange={(r) => absorb(r, true)}
                onDeleted={() => router.push('/admin/research')}
              />
            </aside>
          </div>
        )}
        <ProductCardPicker open={picker} onClose={() => setPicker(false)} products={products} onPick={(pid) => insertBlock.current?.(`{{product:${pid}}}`)} />
        <Modal
          open={!!leaveTo}
          onClose={() => setLeaveTo(null)}
          eyebrow="Unsaved draft"
          title="Leave without saving?"
          size="sm"
          footer={
            <>
              <Btn variant="subtle" onClick={() => setLeaveTo(null)}>Stay</Btn>
              <Btn variant="danger" onClick={() => { const to = leaveTo!; setLeaveTo(null); setSavedDraft(draft); router.push(to); }}>Leave</Btn>
            </>
          }
        >
          <p className="tl-small tl-muted">Your changes to this draft will be lost.</p>
        </Modal>
        <Toasts />
      </div>
    </TlRoot>
  );
}

/** The editable fields of a draft (what `absorb` keeps when the server answers with another copy). */
function payloadFields(d: ResearchDraft): Partial<ResearchDraft> {
  const { title, slug, dek, body, seoTitle, seoDescription, leadImageUrl, leadImageAlt, leadImageWidth, leadImageHeight, authorId, reviewerId, datePublished, relatedProductIds, citations } = d;
  return { title, slug, dek, body, seoTitle, seoDescription, leadImageUrl, leadImageAlt, leadImageWidth, leadImageHeight, authorId, reviewerId, datePublished, relatedProductIds, citations };
}

/* ── RecordSide: publish state, the API's pre-check, the live contract check, and Delete ── */
function RecordSide({ draft, dirty, errors, targets, onChange, onDeleted }: { draft: ResearchDraft; dirty: boolean; errors: Errors; targets: ResearchTarget[]; onChange: (r: ResearchDraft) => void; onDeleted: () => void }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const isNew = !draft.id;
  const live = draft.publishState === 'live' || draft.publishState === 'changed';
  const locked = !!draft.slugLockedAt;
  const errCount = Object.keys(errors).length;

  async function setLive(v: boolean) {
    if (!token || !draft.id) return;
    setBusy(true);
    try {
      const r = v ? await adminPublishResearch(token, draft.id) : await adminUnpublishResearch(token, draft.id);
      onChange(r);
      ok(v ? 'Published' : 'Taken offline', v ? `${r.path} is live.` : 'The URL stays reserved; publish again to bring it back.');
    } catch (e) {
      fail(e, v ? 'Not published' : 'Not changed');
    } finally {
      setBusy(false);
    }
  }
  async function del(d: { redirectTo: string } | { gone: true } | undefined) {
    if (!token) return;
    setBusy(true);
    try {
      await adminDeleteResearch(token, draft.id, d);
      setDelOpen(false);
      ok('Deleted', d ? ('gone' in d ? 'The URL is marked gone.' : `${draft.path} now 301s to ${d.redirectTo}.`) : undefined);
      onDeleted();
    } catch (e) {
      fail(e, 'Not deleted');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="tl-panel">
        <div className="tl-panel-head"><span className="tl-label">Publish state</span><Chip status={draft.publishState} size="sm" /></div>
        <dl className="tl-facts tl-panel-body">
          <dt>URL</dt><dd className="tl-code">{draft.livePath ?? `/research/${draft.slug || '…'}`}</dd>
          <dt>URL lock</dt><dd>{locked ? `Since ${date(draft.slugLockedAt)}` : 'Free until first publish'}</dd>
          <dt>Live since</dt><dd>{date(draft.liveAt)}</dd>
        </dl>
        <div className="tl-panel-body tog" style={{ display: 'grid', gap: 12 }}>
          <Toggle
            value={live}
            disabled={isNew || busy || dirty || (!live && draft.issues.length > 0)}
            label="On the site"
            hint={
              isNew ? 'Save the draft first.'
                : dirty ? 'Save the draft first: publishing sends what is saved.'
                : live ? 'Off takes it down; the URL stays reserved for it.'
                : draft.issues.length ? 'Fix the pre-check first.'
                : 'On publishes the saved draft to /research.'
            }
            onChange={setLive}
          />
          {draft.publishState === 'changed' && (
            <Btn variant="signal" icon="check" block loading={busy} disabled={dirty || draft.issues.length > 0} onClick={() => setLive(true)}>Publish changes</Btn>
          )}
          {live && (
            <a className="tl-link tl-small" href={draft.livePath ?? draft.path} target="_blank" rel="noreferrer">
              View live <Icon name="arrow" size={12} className="inline" />
            </a>
          )}
        </div>
      </div>
      {draft.issues.length > 0 && (
        <div className="tl-panel">
          <div className="tl-panel-head"><span className="tl-label">Pre-check</span><span className="tl-tiny tl-bad">{draft.issues.length} blocking</span></div>
          <ul className="tl-checks">
            {draft.issues.map((i, k) => (
              <li key={k}><button type="button" onClick={() => jumpToField(i.path)}><span className="tl-code tl-bad">{i.path}</span><span className="tl-small">{i.message}</span></button></li>
            ))}
          </ul>
        </div>
      )}
      <div className="tl-panel">
        <div className="tl-panel-head"><span className="tl-label">Contract check</span><span className={`tl-tiny ${errCount ? 'tl-bad' : 'tl-good'}`}>{errCount ? `${errCount} to fix` : 'Ready'}</span></div>
        <ul className="tl-checks">
          {Object.entries(errors).map(([k, msg]) => (
            <li key={k}><button type="button" onClick={() => jumpToField(k)}><span className="tl-code tl-bad">{k}</span><span className="tl-small">{msg}</span></button></li>
          ))}
          {!errCount && <li className="tl-small tl-muted tl-okline"><Icon name="check" size={14} /> Valid against the research contract.</li>}
        </ul>
      </div>
      {!isNew && <Btn variant="danger" icon="trash" block onClick={() => setDelOpen(true)}>Delete research article…</Btn>}
      <DeleteDecision open={delOpen} onClose={() => setDelOpen(false)} what="research article" path={draft.livePath ?? draft.path} published={locked} targets={targets} busy={busy} onConfirm={del} />
    </>
  );
}
