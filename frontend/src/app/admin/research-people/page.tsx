'use client';

// The real people who write and review research articles (Teliti keeps them in its site facts).
// None = the article is written by "Ascend MY editorial team", never by an invented person.
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { adminCreateResearchAuthor, adminDeleteResearchAuthor, adminGetResearchAuthors, adminUpdateResearchAuthor, type ResearchAuthorRow } from '@/lib/api';
import { slugify } from '@/lib/research-admin';
import { Btn, DataTable, Field, Hint, Icon, Modal, PageHeader, TlRoot, Toasts, fail, ok, type Column } from '@/components/admin/tl/kit';

type Input = { name: string; slug: string; role: string; credentials: string; bio: string; sameAs: string };
const blank: Input = { name: '', slug: '', role: '', credentials: '', bio: '', sameAs: '' };

export default function ResearchPeoplePage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<ResearchAuthorRow[] | null>(null);
  const [editing, setEditing] = useState<{ id?: string; value: Input } | null>(null);
  const [deleting, setDeleting] = useState<ResearchAuthorRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!token) return;
    adminGetResearchAuthors(token).then((r) => setRows(r.data)).catch(() => setRows([]));
  }, [token, reload]);

  async function submit() {
    if (!token || !editing) return;
    const v = editing.value;
    const body = {
      name: v.name.trim(),
      ...(editing.id ? {} : { slug: v.slug || slugify(v.name) }),
      role: v.role.trim() || null,
      credentials: v.credentials.trim() || null,
      bio: v.bio.trim() || null,
      sameAs: v.sameAs.split(/\s+/).filter(Boolean),
    };
    setBusy(true);
    try {
      if (editing.id) await adminUpdateResearchAuthor(token, editing.id, body);
      else await adminCreateResearchAuthor(token, body);
      ok(editing.id ? 'Saved' : 'Added', 'Live articles show the change at their next publish.');
      setEditing(null);
      setReload((n) => n + 1);
    } catch (e) {
      fail(e, 'Not saved');
    } finally {
      setBusy(false);
    }
  }
  async function remove(p: ResearchAuthorRow) {
    if (!token) return;
    try {
      await adminDeleteResearchAuthor(token, p.id);
      ok('Removed', 'Their articles now read “Ascend MY editorial team”.');
      setDeleting(null);
      setReload((n) => n + 1);
    } catch (e) {
      fail(e, 'Not removed');
    }
  }
  const set = (k: keyof Input, v: string) => setEditing((x) => (x ? { ...x, value: { ...x.value, [k]: v } } : x));

  const columns: Column<ResearchAuthorRow>[] = [
    { key: 'name', label: 'Name', cell: (p) => (<><div className="tl-strong">{p.name}</div><div className="tl-tiny tl-muted">{[p.role, p.credentials].filter(Boolean).join(', ') || '—'}</div></>) },
    { key: 'written', label: 'Wrote', width: '100px', align: 'right', sm: 'end', cell: (p) => <span className="tl-num">{p._count.written}</span> },
    { key: 'reviewed', label: 'Reviewed', width: '100px', align: 'right', hideSm: true, cell: (p) => <span className="tl-num">{p._count.reviewed}</span> },
    {
      key: 'del', label: '', width: '60px', align: 'right', sm: 'end2',
      cell: (p) => (
        <button type="button" className="tl-muted" title="Remove" aria-label={`Remove ${p.name}`} onClick={(e) => { e.stopPropagation(); setDeleting(p); }}>
          <Icon name="trash" size={15} />
        </button>
      ),
    },
  ];

  return (
    <TlRoot>
      <PageHeader eyebrow="Content" title="Writers & reviewers" actions={<Btn variant="primary" icon="plus" onClick={() => setEditing({ value: blank })}>New person</Btn>}>
        <span>Real people only. An article with no writer is by “Ascend MY editorial team”.</span>
      </PageHeader>
      <DataTable
        columns={columns}
        rows={rows ?? []}
        loading={rows === null}
        onRowClick={(p) => setEditing({ id: p.id, value: { name: p.name, slug: p.slug, role: p.role ?? '', credentials: p.credentials ?? '', bio: p.bio ?? '', sameAs: p.sameAs.join('\n') } })}
        empty={<Hint icon="people" text="Nobody yet: every article is by the editorial team." />}
      />
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        eyebrow="Person"
        title={editing?.id ? 'Edit person' : 'Add a person'}
        size="md"
        footer={
          <>
            <Btn variant="subtle" onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn variant="primary" icon="check" loading={busy} disabled={(editing?.value.name.trim().length ?? 0) < 2} onClick={submit}>Save</Btn>
          </>
        }
      >
        {editing && (
          <div className="tl-grid">
            <Field label="Name" required><input className="tl-input" value={editing.value.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <div className="tl-grid-2">
              <Field label="Role" hint="e.g. Pharmacist, Editor"><input className="tl-input" value={editing.value.role} onChange={(e) => set('role', e.target.value)} /></Field>
              <Field label="Credentials" hint="Printed after a reviewer’s name"><input className="tl-input" value={editing.value.credentials} onChange={(e) => set('credentials', e.target.value)} /></Field>
            </div>
            <Field label="Bio"><textarea className="tl-textarea" rows={3} value={editing.value.bio} onChange={(e) => set('bio', e.target.value)} /></Field>
            <Field label="Profile links" hint="One per line (LinkedIn, ORCID…). Used as sameAs in the article’s structured data.">
              <textarea className="tl-textarea" rows={2} value={editing.value.sameAs} onChange={(e) => set('sameAs', e.target.value)} />
            </Field>
          </div>
        )}
      </Modal>
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        eyebrow="Person"
        title={`Remove ${deleting?.name ?? ''}?`}
        size="sm"
        footer={<><Btn variant="subtle" onClick={() => setDeleting(null)}>Cancel</Btn><Btn variant="danger" icon="trash" onClick={() => deleting && remove(deleting)}>Remove</Btn></>}
      >
        <p className="tl-small tl-muted">Their articles fall back to “Ascend MY editorial team” in the draft; live pages change at the next publish.</p>
      </Modal>
      <Toasts />
    </TlRoot>
  );
}
