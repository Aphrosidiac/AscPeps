'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Send, Megaphone } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetCampaigns, adminCreateCampaign } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Animate } from '@/components/ui/Animate';

interface CampaignRow {
  id: string;
  name: string;
  subject: string;
  audience: 'ALL' | 'BUYERS' | 'NON_BUYERS';
  status: 'DRAFT' | 'SENDING' | 'SENT';
  recipientCount: number;
  sentAt: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<CampaignRow['status'], string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SENDING: 'bg-amber-100 text-amber-800',
  SENT: 'bg-green-100 text-green-800',
};

export const AUDIENCE_LABELS: Record<CampaignRow['audience'], string> = {
  ALL: 'Everyone',
  BUYERS: 'Past buyers',
  NON_BUYERS: 'Never ordered',
};

export default function AdminCampaignsPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    adminGetCampaigns(token, { limit: '50' })
      .then((r) => setCampaigns(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Creating a campaign makes a real draft row immediately and opens it,
  // rather than opening an empty modal that only saves at the end. A newsletter
  // takes several passes to write, and losing that to a stray navigation is
  // the sort of thing that stops people writing them.
  const handleCreate = async () => {
    if (!token) return;
    setCreating(true);
    try {
      const draft = await adminCreateCampaign(token, {
        name: 'Untitled campaign',
        subject: 'Untitled campaign',
        body: 'Write your update here.',
        audience: 'ALL',
      });
      router.push(`/admin/campaigns/${(draft as { id: string }).id}`);
    } catch {
      setCreating(false);
    }
  };

  return (
    <div>
      <Animate variant="fadeUp">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold">Campaigns</h1>
            <p className="text-sm text-text-muted mt-0.5">Newsletters and announcements to the list</p>
          </div>
          <Button onClick={handleCreate} disabled={creating}>
            <Plus className="w-4 h-4" /> New campaign
          </Button>
        </div>
      </Animate>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-surface-elevated rounded" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <Animate variant="fadeUp">
          <div className="text-center py-16">
            <Megaphone className="w-10 h-10 text-text-muted mx-auto mb-3" />
            <p className="text-text-muted text-lg mb-1">No campaigns yet</p>
            <p className="text-text-muted text-sm">A restock announcement is usually the easiest first one.</p>
          </div>
        </Animate>
      ) : (
        <Animate variant="fadeUp" delay={0.05}>
          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-elevated">
                  <th className="text-left px-4 py-3 font-medium text-text-secondary">Campaign</th>
                  <th className="text-left px-4 py-3 font-medium text-text-secondary hidden sm:table-cell">Audience</th>
                  <th className="text-right px-4 py-3 font-medium text-text-secondary hidden md:table-cell">Recipients</th>
                  <th className="text-left px-4 py-3 font-medium text-text-secondary hidden md:table-cell">Sent</th>
                  <th className="text-center px-4 py-3 font-medium text-text-secondary">Status</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-elevated/50 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/admin/campaigns/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-text-muted mt-0.5 line-clamp-1 max-w-md">{c.subject}</p>
                    </td>
                    <td className="px-4 py-3 text-text-secondary hidden sm:table-cell">{AUDIENCE_LABELS[c.audience]}</td>
                    <td className="px-4 py-3 text-right text-text-secondary hidden md:table-cell">
                      {c.status === 'DRAFT' ? <span className="text-text-muted">--</span> : c.recipientCount}
                    </td>
                    <td className="px-4 py-3 text-text-secondary hidden md:table-cell">
                      {c.sentAt ? formatDate(c.sentAt) : <span className="text-text-muted">--</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={STATUS_STYLES[c.status]}>
                        {c.status === 'SENDING' && <Send className="w-3 h-3 mr-1 inline" />}
                        {c.status.charAt(0) + c.status.slice(1).toLowerCase()}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Animate>
      )}
    </div>
  );
}
