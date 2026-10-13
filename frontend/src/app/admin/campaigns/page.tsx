'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Send, Megaphone, Users, CheckCircle2, PenLine } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetCampaigns, adminCreateCampaign, adminPreviewCampaign } from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Animate } from '@/components/ui/Animate';
import { PageHeader } from '@/components/admin/ui';
import { EmailPreview } from '@/components/admin/EmailPreview';

interface CampaignRow {
  id: string;
  name: string;
  subject: string;
  preheader: string | null;
  body: string;
  audience: 'ALL' | 'BUYERS' | 'NON_BUYERS' | 'CUSTOMERS';
  status: 'DRAFT' | 'SENDING' | 'SENT';
  recipientCount: number;
  sentAt: string | null;
  createdAt: string;
}

const STATUS: Record<CampaignRow['status'], { label: string; className: string; icon: typeof Send }> = {
  DRAFT: { label: 'Draft', className: 'bg-gray-100 text-gray-700', icon: PenLine },
  SENDING: { label: 'Sending', className: 'bg-amber-100 text-amber-800', icon: Send },
  SENT: { label: 'Sent', className: 'bg-green-100 text-green-800', icon: CheckCircle2 },
};

export const AUDIENCE_LABELS: Record<CampaignRow['audience'], string> = {
  ALL: 'Everyone',
  BUYERS: 'Past buyers',
  NON_BUYERS: 'Never ordered',
  CUSTOMERS: 'All customers',
};

export default function AdminCampaignsPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    if (!token) return;
    adminGetCampaigns(token, { limit: '50' })
      .then((r) => {
        setCampaigns(r.data);
        // Each card shows the real render — the same endpoint the editor's
        // preview uses — so what you see in the list is what went out (or
        // will). Fetched one by one so a slow render never blanks the list.
        for (const c of r.data as CampaignRow[]) {
          adminPreviewCampaign(token, c.id)
            .then((p) => setPreviews((prev) => ({ ...prev, [c.id]: p.html })))
            .catch(() => {});
        }
      })
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
        {/* Stacks below sm — beside the heading the button had to wrap its own
            label onto two lines and squeezed the subtitle. */}
        <PageHeader
          title="Campaigns"
          subtitle="Write it, check the preview, send yourself a test, then send"
          actions={<Button onClick={handleCreate} disabled={creating}><Plus className="w-4 h-4" /> New campaign</Button>}
        />
      </Animate>

      {loading ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[440px] bg-surface-elevated rounded-xl animate-pulse" />
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
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {campaigns.map((c) => {
              const status = STATUS[c.status];
              const inboxLine = c.preheader?.trim() || c.body.replace(/\s+/g, ' ').trim().slice(0, 140);
              return (
                <Link
                  key={c.id}
                  href={`/admin/campaigns/${c.id}`}
                  className="group bg-surface rounded-xl border border-border overflow-hidden hover:border-border-hover hover:shadow-sm transition-all"
                >
                  <div className="relative">
                    <EmailPreview html={previews[c.id] ?? null} mode="thumb" className="h-[300px]" />
                    {/* Fade the clipped bottom edge so the cut reads as "more
                        below", not as a broken render. */}
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-surface to-transparent" />
                  </div>
                  <div className="p-4 border-t border-border">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <Badge className={cn('inline-flex items-center gap-1', status.className)}>
                        <status.icon className="w-3 h-3" /> {status.label}
                      </Badge>
                      <span className="text-xs text-text-muted">
                        {c.sentAt ? `Sent ${formatDate(c.sentAt)}` : `Created ${formatDate(c.createdAt)}`}
                      </span>
                    </div>
                    <p className="font-semibold text-text-primary truncate group-hover:underline underline-offset-2">{c.subject}</p>
                    <p className="text-sm text-text-muted truncate">{inboxLine}</p>
                    <div className="flex items-center gap-1.5 mt-3 text-xs text-text-secondary">
                      <Users className="w-3.5 h-3.5 text-text-muted" />
                      {AUDIENCE_LABELS[c.audience]}
                      {c.status !== 'DRAFT' && (
                        <span className="text-text-muted">
                          · {c.recipientCount} {c.recipientCount === 1 ? 'person' : 'people'}
                        </span>
                      )}
                      <span className="ml-auto text-text-muted truncate max-w-[45%]" title={c.name}>
                        {c.name}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </Animate>
      )}
    </div>
  );
}
