'use client';

// Teliti's "Research & guides" list (Posts.vue + EntityList.vue), for Ascend's research summaries:
// a publish-state filter, search by title or URL, and each row's publish state and checks.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { adminGetResearchList, type ResearchAdminRow } from '@/lib/api';
import { ago } from '@/lib/research-admin';
import { Btn, Chip, DataTable, Hint, Icon, PageHeader, Segmented, TlRoot, type Column } from '@/components/admin/tl/kit';

type Filter = 'all' | 'live' | 'changed' | 'draft' | 'excluded';

export default function AdminResearchPage() {
  const router = useRouter();
  const { token } = useAuth();
  const [rows, setRows] = useState<ResearchAdminRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!token) return;
    adminGetResearchList(token)
      .then((r) => setRows(r.data))
      .catch(() => setError('Could not load research articles.'));
  }, [token]);

  const all = useMemo(() => rows ?? [], [rows]);
  const count = (f: Filter) => all.filter((r) => r.publishState === f).length || null;
  const options: { value: Filter; label: string; count: number | null }[] = [
    { value: 'all', label: 'All', count: all.length || null },
    { value: 'live', label: 'Live', count: count('live') },
    { value: 'changed', label: 'Changes not live', count: count('changed') },
    { value: 'draft', label: 'Never published', count: count('draft') },
    { value: 'excluded', label: 'Offline', count: count('excluded') },
  ];
  const shown = useMemo(
    () =>
      all.filter(
        (r) =>
          (filter === 'all' || r.publishState === filter) &&
          (!q.trim() || `${r.title} ${r.path}`.toLowerCase().includes(q.trim().toLowerCase()))
      ),
    [all, filter, q]
  );

  const columns: Column<ResearchAdminRow>[] = [
    {
      key: 'title',
      label: 'Title',
      cell: (r) => (
        <>
          <div className="tl-strong tl-ellipsis">{r.title || 'Untitled'}</div>
          <div className="tl-tiny tl-muted tl-ellipsis">
            <span className="tl-code">{r.path}</span> · edited {ago(r.updatedAt)}
          </div>
        </>
      ),
    },
    { key: 'kind', label: 'Kind', width: '150px', hideSm: true, cell: () => <span className="tl-small">Research summary</span> },
    { key: 'publishState', label: 'Publish', width: '170px', sm: 'end2', cell: (r) => <Chip status={r.publishState} /> },
    {
      key: 'issues',
      label: 'Checks',
      width: '110px',
      align: 'right',
      sm: 'end',
      cell: (r) => (r.issues ? <span className="tl-bad tl-small tl-strong">{r.issues} to fix</span> : <span className="tl-good tl-small">Valid</span>),
    },
  ];

  return (
    <TlRoot>
      <PageHeader eyebrow="Content" title="Research" actions={<Btn variant="primary" icon="plus" href="/admin/research/new">New article</Btn>}>
        <span>Research summaries cite their studies. Saving keeps a draft; nothing reaches /research until you publish it.</span>
      </PageHeader>
      <div className="tl-toolbar">
        <Segmented value={filter} onChange={setFilter} options={options} />
        <label className="tl-search">
          <Icon name="search" size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title or URL" aria-label="Search research articles" />
        </label>
      </div>
      {error && <Hint icon="warn" tone="bad" text={error} />}
      <DataTable
        columns={columns}
        rows={shown}
        loading={rows === null && !error}
        onRowClick={(r) => router.push(`/admin/research/${r.id}`)}
        empty={
          <Hint icon="journal" text={q || filter !== 'all' ? 'Nothing matches.' : 'None yet. Import the Teliti set (backend/scripts/import-teliti-research.ts) or add one.'}>
            <Btn size="sm" variant="primary" icon="plus" href="/admin/research/new">New article</Btn>
          </Hint>
        }
      />
    </TlRoot>
  );
}
