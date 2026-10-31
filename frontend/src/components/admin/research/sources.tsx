'use client';

// Cited studies. Teliti keeps a post's studies on the product records and shows the post only a
// count; Ascend edits them here, from one shared library of sources, in the same panel language.

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { adminCreateResearchSource, adminGetResearchSources, adminLookupPubmed, adminUpdateResearchSource, type ResearchSourceRow } from '@/lib/api';
import { sourceLinks } from '@/lib/research';
import { Btn, Counter, Field, Hint, Icon, Modal, Segmented, fail, ok } from '@/components/admin/tl/kit';
import type { ResearchCitation, ResearchSource } from '@/types';

type SourceInput = Omit<ResearchSource, 'id'>;
const blankSource: SourceInput = { pmid: '', doi: '', url: '', journal: '', year: new Date().getFullYear(), title: '' };

export function SourceLinks({ s }: { s: Pick<ResearchSource, 'pmid' | 'doi' | 'url'> }) {
  return (
    <>
      {sourceLinks(s).map((l, i) => (
        <span key={l.href}>
          {i > 0 && ' · '}
          <a className="tl-link" href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
        </span>
      ))}
    </>
  );
}

/** One study's record. PMID fills the rest from PubMed; a PMID, DOI or URL is required. */
export function SourceForm({ value, onChange, errors = {} }: { value: SourceInput; onChange: (v: SourceInput) => void; errors?: Record<string, string> }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SourceInput>(k: K, v: SourceInput[K]) => onChange({ ...value, [k]: v });
  async function lookup() {
    if (!token || !value.pmid) return;
    setBusy(true);
    try {
      const r = await adminLookupPubmed(token, value.pmid);
      onChange({ ...value, pmid: r.pmid, doi: r.doi ?? value.doi, title: r.title, journal: r.journal, year: r.year ?? value.year });
      ok('Filled from PubMed', 'Check the title and journal against the paper.');
    } catch (e) {
      fail(e, 'Not found');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="tl-grid">
      <div className="tl-grid-2">
        <Field label="PubMed ID" error={errors.pmid} hint="5–9 digits. Fetch fills the rest.">
          <div className="tl-row gap-2">
            <input className="tl-input" inputMode="numeric" value={value.pmid ?? ''} onChange={(e) => set('pmid', e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), lookup())} />
            <Btn variant="ghost" size="sm" loading={busy} disabled={!/^\d{5,9}$/.test(value.pmid ?? '')} onClick={lookup}>Fetch</Btn>
          </div>
        </Field>
        <Field label="DOI" error={errors.doi} hint="10.xxxx/…, without https://doi.org/">
          <input className="tl-input" value={value.doi ?? ''} onChange={(e) => set('doi', e.target.value.trim())} />
        </Field>
      </div>
      <Field label="Title" required error={errors.title}>
        <textarea className="tl-textarea" rows={2} style={{ minHeight: 64, fieldSizing: 'content' } as React.CSSProperties} value={value.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <div className="tl-grid-2">
        <Field label="Journal" required error={errors.journal}>
          <input className="tl-input" value={value.journal} onChange={(e) => set('journal', e.target.value)} />
        </Field>
        <Field label="Year" required error={errors.year}>
          <input className="tl-input" inputMode="numeric" value={value.year || ''} onChange={(e) => set('year', Number(e.target.value.replace(/\D/g, '')) || 0)} />
        </Field>
      </div>
      <Field label="URL" error={errors.url} hint="Only when the study has no PMID or DOI.">
        <input className="tl-input" value={value.url ?? ''} placeholder="https://" onChange={(e) => set('url', e.target.value.trim())} />
      </Field>
    </div>
  );
}

const detailsToErrors = (e: unknown) =>
  Object.fromEntries(((e as { response?: { data?: { details?: { path: string; message: string }[] } } })?.response?.data?.details ?? []).map((d) => [d.path, d.message]));

export function useSaveSource() {
  const { token } = useAuth();
  return async (v: SourceInput, id?: string): Promise<{ ok: true; source: ResearchSource } | { ok: false; errors: Record<string, string> }> => {
    if (!token) return { ok: false, errors: {} };
    const body = { ...v, pmid: v.pmid || null, doi: v.doi || null, url: v.url || null };
    try {
      const source = id ? await adminUpdateResearchSource(token, id, body) : await adminCreateResearchSource(token, body);
      return { ok: true, source };
    } catch (e) {
      fail(e, 'Not saved');
      return { ok: false, errors: detailsToErrors(e) };
    }
  };
}

/** Add a study: from the library, or a new one. */
type AddProps = { open: boolean; onClose: () => void; exclude: string[]; onAdd: (s: ResearchSource) => void };
export function AddStudy(props: AddProps) {
  return props.open ? <AddStudyDialog {...props} /> : null;
}
function AddStudyDialog({ open, onClose, exclude, onAdd }: AddProps) {
  const { token } = useAuth();
  const [tab, setTab] = useState<'library' | 'new'>('library');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<ResearchSourceRow[] | null>(null);
  const [draft, setDraft] = useState<SourceInput>(blankSource);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const save = useSaveSource();
  useEffect(() => {
    if (!open || !token || tab !== 'library') return;
    const t = setTimeout(() => {
      adminGetResearchSources(token, { limit: '50', ...(q.trim() ? { search: q.trim() } : {}) }).then((r) => setRows(r.data)).catch(() => setRows([]));
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [open, token, q, tab]);
  const shown = (rows ?? []).filter((s) => !exclude.includes(s.id));
  async function create() {
    setBusy(true);
    const r = await save(draft);
    setBusy(false);
    if (r.ok) { onAdd(r.source); onClose(); ok('Study added', 'Saved to the source library too.'); }
    else setErrors(r.errors);
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Cited studies"
      title="Add a study"
      size="lg"
      footer={tab === 'new' ? (
        <>
          <Btn variant="subtle" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" icon="plus" loading={busy} onClick={create}>Add study</Btn>
        </>
      ) : undefined}
    >
      <Segmented value={tab} onChange={setTab} options={[{ value: 'library', label: 'From the library' }, { value: 'new', label: 'New study' }]} />
      {tab === 'library' ? (
        <>
          <label className="tl-search mt-4" style={{ width: '100%', marginLeft: 0 }}>
            <Icon name="search" size={15} />
            <input value={q} autoFocus placeholder="Title, journal, DOI or PMID" onChange={(e) => setQ(e.target.value)} />
          </label>
          <ul className="tl-opts">
            {shown.map((s) => (
              <li key={s.id} onClick={() => { onAdd(s); onClose(); }}>
                <span className="tl-grow">
                  <span className="tl-strong" style={{ display: 'block' }}>{s.title}</span>
                  <span className="tl-tiny tl-muted">{s.journal}, {s.year} · {s.citedIn.length ? `cited in ${s.citedIn.length}` : 'not cited yet'}</span>
                </span>
                <span className="tl-code tl-muted no-phone">{s.pmid ? `PMID ${s.pmid}` : s.doi ?? ''}</span>
              </li>
            ))}
            {rows !== null && !shown.length && (
              <li className="none tl-small tl-muted">{q ? 'Nothing matches.' : 'The library is empty.'} <button type="button" className="tl-link" onClick={() => setTab('new')}>Add a new study</button></li>
            )}
          </ul>
        </>
      ) : (
        <div className="mt-4"><SourceForm value={draft} onChange={setDraft} errors={errors} /></div>
      )}
    </Modal>
  );
}

/** The article's cited studies, in order: what each one found, then its record and links. */
export function CitationsField({ value, onChange, errors, error }: { value: ResearchCitation[]; onChange: (v: ResearchCitation[]) => void; errors: Record<string, string>; error?: string | null }) {
  const [adding, setAdding] = useState(false);
  const move = (i: number, d: -1 | 1) => {
    const a = [...value];
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    onChange(a.map((c, k) => ({ ...c, position: k + 1 })));
  };
  const set = (i: number, finding: string) => onChange(value.map((c, k) => (k === i ? { ...c, finding } : c)));
  return (
    <Field data-field="citations" label="Cited studies" required error={error} hint="Research summaries cite at least two. Each says what the study found; the reader gets its DOI and PubMed links.">
      <div className="tl-cites">
        {value.map((c, i) => (
          <div key={c.sourceId} className="tl-cite" data-field={`citations.${i}`}>
            <span className="n">{i + 1}</span>
            <div className="tl-grid gap-2">
              <Field label="What it found" error={errors[`citations.${i}.finding`]}>
                <textarea className="tl-textarea" rows={2} maxLength={600} style={{ minHeight: 64, fieldSizing: 'content' } as React.CSSProperties} value={c.finding} onChange={(e) => set(i, e.target.value)} />
                <div className="tl-under"><Counter value={c.finding} min={20} max={400} /></div>
              </Field>
              <div className="tl-small">
                <span className="tl-strong">{c.source.title}</span>{' '}
                <span className="tl-muted"><i>{c.source.journal}</i>, {c.source.year}. </span>
                <span className="tl-tiny"><SourceLinks s={c.source} /></span>
              </div>
            </div>
            <div className="ctl">
              <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="up" size={14} /></button>
              <button type="button" aria-label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}><Icon name="down" size={14} /></button>
              <button type="button" aria-label="Remove" onClick={() => onChange(value.filter((_, k) => k !== i).map((x, k) => ({ ...x, position: k + 1 })))}><Icon name="close" size={14} /></button>
            </div>
          </div>
        ))}
        {value.length === 0 && <Hint icon="journal" text="No studies cited yet." />}
        <div><Btn size="sm" variant="ghost" icon="plus" onClick={() => setAdding(true)}>Add a study</Btn></div>
      </div>
      <AddStudy
        open={adding}
        onClose={() => setAdding(false)}
        exclude={value.map((c) => c.sourceId)}
        onAdd={(s) => onChange([...value, { position: value.length + 1, finding: '', sourceId: s.id, source: s }])}
      />
    </Field>
  );
}
