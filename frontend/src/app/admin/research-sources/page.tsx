'use client';

// The study library every research article cites from. A study still cited somewhere can't be
// deleted (the API refuses): take the citation out of the article first.
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { adminDeleteResearchSource, adminGetResearchSources, type ResearchSourceRow } from '@/lib/api';
import { Btn, DataTable, Hint, Icon, Modal, PageHeader, TlRoot, Toasts, fail, ok, type Column } from '@/components/admin/tl/kit';
import { SourceForm, SourceLinks, useSaveSource } from '@/components/admin/research/sources';
import type { ResearchSource } from '@/types';

type Input = Omit<ResearchSource, 'id'>;
const blank: Input = { pmid: '', doi: '', url: '', journal: '', year: new Date().getFullYear(), title: '' };

export default function ResearchSourcesPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<ResearchSourceRow[] | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ id?: string; value: Input; cited: ResearchSourceRow['citedIn'] } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ResearchSourceRow | null>(null);
  const [reload, setReload] = useState(0);
  const save = useSaveSource();

  useEffect(() => {
    if (!token) return;
    const t = setTimeout(() => {
      adminGetResearchSources(token, { limit: '100', ...(q.trim() ? { search: q.trim() } : {}) })
        .then((r) => setRows(r.data))
        .catch(() => setRows([]));
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [token, q, reload]);

  async function submit() {
    if (!editing) return;
    setBusy(true);
    const r = await save(editing.value, editing.id);
    setBusy(false);
    if (!r.ok) return setErrors(r.errors);
    ok(editing.id ? 'Study saved' : 'Study added', editing.cited.some((a) => a.liveAt) ? 'Live articles show the change at their next publish.' : undefined);
    setEditing(null);
    setReload((n) => n + 1);
  }
  async function remove(s: ResearchSourceRow) {
    if (!token) return;
    try {
      await adminDeleteResearchSource(token, s.id);
      ok('Study deleted');
      setDeleting(null);
      setReload((n) => n + 1);
    } catch (e) {
      fail(e, 'Not deleted');
    }
  }

  const columns: Column<ResearchSourceRow>[] = [
    {
      key: 'title',
      label: 'Study',
      cell: (s) => (
        <>
          <div className="tl-strong">{s.title}</div>
          <div className="tl-tiny tl-muted"><i>{s.journal}</i>, {s.year} · <span onClick={(e) => e.stopPropagation()}><SourceLinks s={s} /></span></div>
        </>
      ),
    },
    {
      key: 'cited',
      label: 'Cited in',
      width: '260px',
      sm: 'end2',
      cell: (s) =>
        s.citedIn.length ? (
          <span className="tl-small">{s.citedIn.map((a) => a.title).join(', ')}</span>
        ) : (
          <span className="tl-small tl-muted">Not cited</span>
        ),
    },
    {
      key: 'del',
      label: '',
      width: '60px',
      align: 'right',
      sm: 'end',
      cell: (s) => (
        <button type="button" className="tl-muted" title="Delete" aria-label={`Delete ${s.title}`} onClick={(e) => { e.stopPropagation(); setDeleting(s); }}>
          <Icon name="trash" size={15} />
        </button>
      ),
    },
  ];

  return (
    <TlRoot>
      <PageHeader eyebrow="Content" title="Research sources" actions={<Btn variant="primary" icon="plus" onClick={() => { setErrors({}); setEditing({ value: blank, cited: [] }); }}>New study</Btn>}>
        <span>Every study the research articles cite, once. Each needs a PMID, DOI or URL a reader can check.</span>
      </PageHeader>
      <div className="tl-toolbar">
        <label className="tl-search">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, journal, DOI or PMID" aria-label="Search studies" />
        </label>
      </div>
      <DataTable
        columns={columns}
        rows={rows ?? []}
        loading={rows === null}
        onRowClick={(s) => { setErrors({}); setEditing({ id: s.id, value: { pmid: s.pmid ?? '', doi: s.doi ?? '', url: s.url ?? '', journal: s.journal, year: s.year, title: s.title }, cited: s.citedIn }); }}
        empty={<Hint icon="journal" text={q ? 'Nothing matches.' : 'No studies yet. They are added here or from an article’s Cited studies.'} />}
      />
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        eyebrow={editing?.id ? 'Study' : 'New study'}
        title={editing?.id ? 'Edit study' : 'Add a study'}
        size="lg"
        footer={
          <>
            <Btn variant="subtle" onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn variant="primary" icon="check" loading={busy} onClick={submit}>{editing?.id ? 'Save study' : 'Add study'}</Btn>
          </>
        }
      >
        {editing && (
          <>
            {editing.cited.length > 0 && <p className="tl-small tl-muted mb-2">Cited in {editing.cited.map((a) => a.title).join(', ')}.</p>}
            <SourceForm value={editing.value} onChange={(value) => setEditing((x) => (x ? { ...x, value } : x))} errors={errors} />
          </>
        )}
      </Modal>
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        eyebrow="Study"
        title="Delete this study?"
        size="sm"
        footer={
          <>
            <Btn variant="subtle" onClick={() => setDeleting(null)}>Cancel</Btn>
            <Btn variant="danger" icon="trash" disabled={!!deleting?.citedIn.length} onClick={() => deleting && remove(deleting)}>Delete study</Btn>
          </>
        }
      >
        <p className="tl-small tl-muted">
          {deleting?.citedIn.length
            ? `Cited in ${deleting.citedIn.map((a) => `“${a.title}”`).join(', ')}. Remove the citation there first.`
            : 'It is not cited anywhere, so nothing changes on the site.'}
        </p>
      </Modal>
      <Toasts />
    </TlRoot>
  );
}
