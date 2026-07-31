'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Animate } from '@/components/ui/Animate';
import {
  Bot,
  Link2,
  CheckCircle2,
  Loader2,
  LogOut,
  MessageSquare,
  Power,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Users,
  Wrench,
  XCircle,
} from 'lucide-react';
import {
  adminAgentBindSender,
  adminAgentConversation,
  adminAgentConversations,
  adminAgentDismissSender,
  adminAgentDeleteOperator,
  adminAgentOperators,
  adminAgentSaveGroup,
  adminAgentSaveOperator,
  adminAgentToolCalls,
  adminAgentUnknownSenders,
  adminWhatsAppConnect,
  adminWhatsAppDisconnect,
  adminWhatsAppGroups,
  adminWhatsAppQR,
  adminWhatsAppStatus,
  adminWhatsAppStop,
} from '@/lib/api';

interface Status {
  phase: string;
  connected: boolean;
  phone: string | null;
  hasQr: boolean;
  hasSession: boolean;
  stopped: boolean;
  stopReason: string | null;
  agentEnabled: boolean;
  reconnectAttempts: number;
  downSeconds: number | null;
}

interface Operator {
  id: string;
  phone: string;
  name: string;
  active: boolean;
  canWrite: boolean;
}

interface GroupRow {
  jid: string;
  subject: string;
  participantCount: number;
  enabled: boolean;
  requireMention: boolean;
}

interface ToolCall {
  id: string;
  toolName: string;
  actorPhone: string;
  ok: boolean;
  destructive: boolean;
  durationMs: number;
  result: string;
  createdAt: string;
}

interface Conversation {
  id: string;
  chatKey: string;
  kind: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
}

interface UnknownSender {
  id: string;
  identifier: string;
  isLid: boolean;
  pushName: string | null;
  lastMessage: string | null;
  messageCount: number;
  lastSeenAt: string;
}

interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  senderName: string | null;
  createdAt: string;
}

interface ConversationDetail extends Conversation {
  messages: ConversationMessage[];
}

// Axios rejects with an error carrying the server's JSON body; this is the
// shape we actually read off it.
interface ApiError {
  message?: string;
  response?: { data?: { message?: string } };
}

function errorMessage(e: unknown, fallback: string): string {
  const err = e as ApiError;
  return err?.response?.data?.message ?? err?.message ?? fallback;
}

// The connection is the thing that silently dies, so its state gets the most
// visual weight on this page — PM2 reporting "online" tells you nothing about
// whether the socket underneath is alive.
const PHASE_COPY: Record<string, { label: string; tone: string }> = {
  connected: { label: 'Connected', tone: 'text-success' },
  qr_pending: { label: 'Waiting for QR scan', tone: 'text-warning' },
  connecting: { label: 'Connecting…', tone: 'text-warning' },
  reconnecting: { label: 'Reconnecting…', tone: 'text-warning' },
  stopped: { label: 'Stopped', tone: 'text-text-secondary' },
  idle: { label: 'Idle', tone: 'text-text-secondary' },
  worker_unreachable: { label: 'Worker unreachable', tone: 'text-danger' },
};

export default function AgentPage() {
  const { token } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [openConversation, setOpenConversation] = useState<ConversationDetail | null>(null);
  const [unknown, setUnknown] = useState<UnknownSender[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [newOp, setNewOp] = useState({ phone: '', name: '', canWrite: true });

  // Deliberately not an async function: every setState lands in a promise
  // callback rather than after an await in the effect body, which is the
  // pattern the rest of the admin pages use and what keeps React's
  // set-state-in-effect rule satisfied.
  const refresh = useCallback(() => {
    if (!token) return;

    adminWhatsAppStatus(token)
      .then((s) => {
        setStatus(s.data);
        if (s.data?.hasQr) {
          adminWhatsAppQR(token)
            .then((q) => setQr(q.data?.qr ?? null))
            .catch(() => setQr(null));
        } else {
          setQr(null);
        }
      })
      // The status endpoint already degrades to worker_unreachable rather than
      // failing, so there is nothing useful to show on a network error here.
      .catch(() => {});

    adminAgentOperators(token)
      .then((ops) => setOperators(ops.operators ?? []))
      .catch(() => {});

    adminWhatsAppGroups(token)
      .then((g) => {
        setGroups(g.data ?? []);
        setGroupsError(null);
      })
      .catch((e: unknown) => {
        // Expected while disconnected — the group list comes from the live
        // socket, so it is unavailable until the number is paired.
        setGroupsError(errorMessage(e, 'Connect WhatsApp to list groups'));
        setGroups([]);
      });

    adminAgentToolCalls(token, { limit: '25' })
      .then(setToolCalls)
      .catch(() => {});

    adminAgentConversations(token)
      .then(setConversations)
      .catch(() => {});

    adminAgentUnknownSenders(token)
      .then(setUnknown)
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    refresh();
    // A QR expires in about two minutes, so while one is on screen poll fast
    // enough to replace it before someone scans a dead code.
    const interval = setInterval(refresh, status?.hasQr ? 5000 : 15000);
    return () => clearInterval(interval);
  }, [refresh, status?.hasQr]);

  const act = (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    fn()
      .then(() => refresh())
      .catch((e: unknown) => alert(errorMessage(e, 'Failed')))
      .finally(() => setBusy(null));
  };

  if (!token) return <div className="p-8 text-text-secondary">Loading…</div>;

  const phase = PHASE_COPY[status?.phase ?? 'idle'] ?? { label: status?.phase ?? '—', tone: 'text-text-secondary' };

  return (
    <div className="space-y-8 p-6 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-text-primary">
            <Bot className="h-6 w-6" /> WhatsApp Agent
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            An admin assistant on WhatsApp. It can do anything you can do in this dashboard.
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-elevated active:scale-[0.98]"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      {/* The kill switch is env-controlled, so surface it prominently rather
          than letting someone wonder why a paired number never replies. */}
      {status && !status.agentEnabled && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">The agent is switched off.</p>
            <p className="mt-1 text-amber-800">
              Messages are received and logged, but nothing is answered and no action is taken. Set{' '}
              <code className="rounded bg-surface-elevated px-1">WHATSAPP_AGENT_ENABLED=true</code> in the backend environment
              and restart both <code className="rounded bg-surface-elevated px-1">ascend-api</code> and{' '}
              <code className="rounded bg-surface-elevated px-1">ascend-wa</code> to enable it.
            </p>
          </div>
        </div>
      )}

      {/* ---- Connection ---- */}
      <Animate variant="fadeUp">
      <section className="rounded-xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-lg font-medium ${phase.tone}`}>{phase.label}</span>
              {status?.connected && status.phone && (
                <span className="text-sm text-text-secondary">+{status.phone}</span>
              )}
            </div>
            <p className="mt-1 text-xs text-text-muted">
              {status?.stopped && status.stopReason === 'max_attempts'
                ? 'Gave up reconnecting — no saved session, a QR re-scan is required.'
                : status?.downSeconds
                  ? `Down for ${Math.round(status.downSeconds / 60)} min (attempt ${status.reconnectAttempts})`
                  : status?.hasSession
                    ? 'Session saved — Start resumes without a new QR scan.'
                    : 'No saved session.'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              disabled={!!busy}
              onClick={() => act('connect', () => adminWhatsAppConnect(token))}
              className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              {busy === 'connect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              Start
            </button>
            <button
              disabled={!!busy}
              onClick={() => act('stop', () => adminWhatsAppStop(token))}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary hover:bg-surface-elevated disabled:opacity-50"
            >
              Stop
            </button>
            <button
              disabled={!!busy}
              onClick={() => {
                if (!confirm('Log out this WhatsApp number? A QR re-scan will be required to reconnect.')) return;
                act('disconnect', () => adminWhatsAppDisconnect(token));
              }}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-danger hover:bg-red-50 disabled:opacity-50"
            >
              <LogOut className="h-4 w-4" /> Log out
            </button>
          </div>
        </div>

        {qr && (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-elevated p-6">
            {/* Plain img, matching the other admin screens: the QR is a
                base64 data URI regenerated every ~30s, so there is nothing for
                next/image's optimizer to do with it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="WhatsApp QR code" width={256} height={256} className="rounded bg-white p-2" />
            <p className="text-sm text-text-secondary">
              WhatsApp → Settings → Linked devices → Link a device. The code refreshes automatically.
            </p>
          </div>
        )}
      </section>

      </Animate>

      {/* ---- Operators ---- */}
      <Animate variant="fadeUp" delay={0.05}>
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="flex items-center gap-2 text-lg font-medium text-text-primary">
          <Users className="h-5 w-5" /> Who can command the agent
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Only these numbers are answered. Everyone else is ignored silently. Full access means that person can change
          prices, delete orders and record payouts through WhatsApp.
        </p>

        <div className="mt-4 space-y-2">
          {operators.map((op, i) => (
            <div
              key={op.id}
              style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}
              className="row-rise flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-elevated px-4 py-3 transition-colors hover:border-border-hover"
            >
              <div>
                <p className="font-medium text-text-primary">{op.name}</p>
                <p className="text-sm text-text-muted">{op.phone}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-xs ${
                    !op.active
                      ? 'bg-surface-elevated text-text-muted'
                      : op.canWrite
                        ? 'bg-green-50 text-green-700'
                        : 'bg-blue-50 text-blue-700'
                  }`}
                >
                  {!op.active ? 'revoked' : op.canWrite ? 'full access' : 'read-only'}
                </span>
                <button
                  onClick={() =>
                    act(`op-${op.id}`, () =>
                      adminAgentSaveOperator(token, {
                        phone: op.phone,
                        name: op.name,
                        active: op.active,
                        canWrite: !op.canWrite,
                      })
                    )
                  }
                  className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-elevated"
                >
                  {op.canWrite ? 'Make read-only' : 'Give full access'}
                </button>
                <button
                  onClick={() =>
                    act(`op-${op.id}`, () =>
                      adminAgentSaveOperator(token, {
                        phone: op.phone,
                        name: op.name,
                        active: !op.active,
                        canWrite: op.canWrite,
                      })
                    )
                  }
                  className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface-elevated"
                >
                  {op.active ? 'Revoke' : 'Restore'}
                </button>
                <button
                  onClick={() => {
                    if (!confirm(`Remove ${op.name} completely?`)) return;
                    act(`op-${op.id}`, () => adminAgentDeleteOperator(token, op.id));
                  }}
                  className="rounded border border-border p-1.5 text-danger hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
          {!operators.length && (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
              No operators yet — nobody can use the agent until one is added.
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4">
          <div>
            <label className="block text-xs text-text-muted">Phone</label>
            <input
              value={newOp.phone}
              onChange={(e) => setNewOp({ ...newOp, phone: e.target.value })}
              placeholder="0161092723"
              className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted">Name</label>
            <input
              value={newOp.name}
              onChange={(e) => setNewOp({ ...newOp, name: e.target.value })}
              placeholder="Fakhrul"
              className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={newOp.canWrite}
              onChange={(e) => setNewOp({ ...newOp, canWrite: e.target.checked })}
            />
            Full access
          </label>
          <button
            disabled={!newOp.phone || !newOp.name || !!busy}
            onClick={() =>
              act('add-op', async () => {
                await adminAgentSaveOperator(token, { ...newOp, active: true });
                setNewOp({ phone: '', name: '', canWrite: true });
              })
            }
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
          >
            Add operator
          </button>
        </div>
      </section>

      </Animate>

      {/* ---- Unrecognised senders ----
           The recovery path for WhatsApp LIDs: many DMs now carry a privacy
           identifier and no phone number, so the operator cannot be matched by
           number and would otherwise be ignored with no visible reason. */}
      {unknown.length > 0 && (
        <section className="panel-reveal rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="flex items-center gap-2 text-lg font-medium text-amber-900">
            <Link2 className="h-5 w-5" /> Unrecognised senders
          </h2>
          <p className="mt-1 text-sm text-amber-800">
            These messaged the agent but could not be matched to an operator, so they were ignored. WhatsApp often hides
            the phone number and sends only a privacy ID — if one of these is you or your team, bind it to the right
            operator. The name shown is whatever the sender set, so confirm it is really them before binding.
          </p>

          <div className="mt-4 space-y-2">
            {unknown.map((u, i) => (
              <div
                key={u.id}
                style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
                className="row-rise rounded-lg border border-amber-200 bg-surface px-4 py-3 transition-shadow hover:shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text-primary">
                      {u.pushName || 'Unnamed'}{' '}
                      <span className="text-xs font-normal text-text-muted">
                        {u.isLid ? `privacy ID ${u.identifier}` : u.identifier}
                      </span>
                    </p>
                    {u.lastMessage && (
                      <p className="mt-0.5 truncate text-sm text-text-secondary">&ldquo;{u.lastMessage}&rdquo;</p>
                    )}
                    <p className="mt-0.5 text-xs text-text-muted">
                      {u.messageCount} message{u.messageCount === 1 ? '' : 's'} · last{' '}
                      {new Date(u.lastSeenAt).toLocaleString('en-MY')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const operatorId = e.target.value;
                        if (!operatorId) return;
                        act(`bind-${u.id}`, () => adminAgentBindSender(token, u.identifier, operatorId));
                      }}
                      className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
                    >
                      <option value="">Bind to…</option>
                      {operators
                        .filter((o) => o.active)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name} ({o.phone})
                          </option>
                        ))}
                    </select>
                    <button
                      onClick={() => act(`dismiss-${u.id}`, () => adminAgentDismissSender(token, u.identifier))}
                      className="rounded border border-border p-1.5 text-text-muted hover:bg-surface-elevated"
                      title="Dismiss — not one of ours"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- Groups ---- */}
      <Animate variant="fadeUp" delay={0.1}>
      <section className="rounded-xl border border-border bg-surface p-6">
        <h2 className="flex items-center gap-2 text-lg font-medium text-text-primary">
          <MessageSquare className="h-5 w-5" /> Groups
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          Groups the connected number is in. The agent stays silent in every group that is switched off here — even for
          operators. Both gates must pass: the person AND the group.
        </p>

        {groupsError ? (
          <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
            {groupsError}
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {groups.map((g, i) => (
              <div
                key={g.jid}
                style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}
                className="row-rise flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-elevated px-4 py-3 transition-colors hover:border-border-hover"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-primary">{g.subject}</p>
                  <p className="text-xs text-text-muted">{g.participantCount} members</p>
                </div>
                <div className="flex items-center gap-3">
                  {g.enabled && (
                    <label className="flex items-center gap-2 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={g.requireMention}
                        onChange={(e) =>
                          act(`grp-${g.jid}`, () =>
                            adminAgentSaveGroup(token, {
                              groupJid: g.jid,
                              subject: g.subject,
                              active: true,
                              requireMention: e.target.checked,
                            })
                          )
                        }
                      />
                      only when mentioned
                    </label>
                  )}
                  <button
                    onClick={() =>
                      act(`grp-${g.jid}`, () =>
                        adminAgentSaveGroup(token, {
                          groupJid: g.jid,
                          subject: g.subject,
                          active: !g.enabled,
                          requireMention: g.requireMention,
                        })
                      )
                    }
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                      g.enabled
                        ? 'bg-green-50 text-green-700 hover:bg-green-100'
                        : 'border border-border text-text-secondary hover:bg-surface-elevated'
                    }`}
                  >
                    {g.enabled ? 'Agent on' : 'Agent off'}
                  </button>
                </div>
              </div>
            ))}
            {!groups.length && (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
                This number is not in any groups.
              </p>
            )}
          </div>
        )}
      </section>

      </Animate>

      {/* ---- Activity ---- */}
      <Animate variant="fadeUp" delay={0.15}>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="flex items-center gap-2 text-lg font-medium text-text-primary">
            <Wrench className="h-5 w-5" /> Recent actions
          </h2>
          <p className="mt-1 text-sm text-text-secondary">Every tool the agent ran, and whether it worked.</p>
          <div className="mt-4 max-h-96 space-y-1.5 overflow-y-auto">
            {toolCalls.map((t, i) => (
              <div
                key={t.id}
                style={{ animationDelay: `${Math.min(i * 25, 300)}ms` }}
                className="row-rise flex items-start gap-2 rounded-lg bg-surface-elevated px-3 py-2 text-sm transition-colors hover:bg-border/40"
              >
                {t.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-text-primary">{t.toolName}</code>
                    {t.destructive && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">confirmed</span>
                    )}
                    <span className="text-xs text-text-muted">{t.actorPhone}</span>
                    <span className="text-xs text-text-muted">{t.durationMs}ms</span>
                  </div>
                  {!t.ok && <p className="mt-0.5 truncate text-xs text-danger">{t.result}</p>}
                </div>
                <span className="shrink-0 text-xs text-text-muted">
                  {new Date(t.createdAt).toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
            {!toolCalls.length && <p className="py-6 text-center text-sm text-text-muted">Nothing yet.</p>}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface p-6">
          <h2 className="flex items-center gap-2 text-lg font-medium text-text-primary">
            <MessageSquare className="h-5 w-5" /> Conversations
          </h2>
          <p className="mt-1 text-sm text-text-secondary">Click one to read the thread.</p>
          <div className="mt-4 max-h-96 space-y-1.5 overflow-y-auto">
            {conversations.map((c, i) => (
              <button
                key={c.id}
                onClick={() => {
                  adminAgentConversation(token, c.id).then(setOpenConversation).catch(() => {});
                }}
                style={{ animationDelay: `${Math.min(i * 30, 300)}ms` }}
                className="row-rise flex w-full items-center justify-between rounded-lg bg-surface-elevated px-3 py-2 text-left text-sm transition-colors hover:bg-border"
              >
                <div className="min-w-0">
                  <p className="truncate text-text-primary">{c.title}</p>
                  <p className="text-xs text-text-muted">
                    {c.kind} · {c.messageCount} messages
                  </p>
                </div>
                <span className="shrink-0 text-xs text-text-muted">
                  {new Date(c.lastMessageAt).toLocaleDateString('en-MY')}
                </span>
              </button>
            ))}
            {!conversations.length && <p className="py-6 text-center text-sm text-text-muted">Nothing yet.</p>}
          </div>
        </section>
      </div>
      </Animate>

      {openConversation && (
        <div
          className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpenConversation(null)}
        >
          <div
            className="dialog-panel max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-surface p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-medium text-text-primary">{openConversation.title}</h3>
              <button onClick={() => setOpenConversation(null)} className="text-text-muted hover:text-text-primary">
                ✕
              </button>
            </div>
            <div className="space-y-3">
              {openConversation.messages?.map((m, i) => (
                <div
                  key={m.id}
                  style={{ animationDelay: `${Math.min(i * 30, 400)}ms` }}
                  className={`row-rise rounded-lg px-3 py-2 text-sm ${
                    m.role === 'assistant' ? 'bg-surface-elevated text-text-primary' : 'bg-surface-elevated text-text-primary'
                  }`}
                >
                  <p className="mb-1 text-xs text-text-muted">
                    {m.role === 'assistant' ? 'Agent' : (m.senderName ?? 'Operator')} ·{' '}
                    {new Date(m.createdAt).toLocaleString('en-MY')}
                  </p>
                  <p className="whitespace-pre-line">{m.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
