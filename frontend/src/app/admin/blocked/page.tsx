'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, Plus, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminAddBlockEntry,
  adminCreateBlocked,
  adminDeleteBlocked,
  adminGetBlocked,
  adminRemoveBlockEntry,
  apiError,
  type BlockKind,
  type BlockedCustomerRow,
} from '@/lib/api';
import { formatDate, formatShortDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, Field, PageHeader, SelectInput, TextArea, TextInput } from '@/components/admin/ui';

const KIND_LABEL: Record<BlockKind, string> = {
  EMAIL: 'Email',
  PHONE: 'Phone',
  ADDRESS: 'Address',
  NETWORK: 'IP',
};

const lines = (v: string) =>
  v
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * People banned from the store. Anything on a person's list — email, phone,
 * delivery address, IP — refuses checkout, sign-up, login, newsletter and
 * Group Buy sign-up, and a refused request adds whatever else was in it to the
 * same list ("Learnt"). Learnt IPs lapse after 60 days without a new attempt.
 */
export default function AdminBlockedPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState<BlockedCustomerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    adminGetBlocked(token)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(apiError(e, "Couldn't reach the server. Try again.").message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(load, [load]);

  const attempts = rows.reduce((n, r) => n + r._count.attempts, 0);

  return (
    <div className="max-w-[1080px]">
      <PageHeader
        title="Blocked customers"
        icon={Ban}
        subtitle={
          rows.length
            ? `${rows.length} ${rows.length === 1 ? 'person' : 'people'} · ${attempts} refused attempt${attempts !== 1 ? 's' : ''}`
            : 'People who can no longer order, sign up or log in'
        }
        actions={
          !adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="w-4 h-4" /> Block someone
            </Button>
          )
        }
      />

      {error && <p className="text-sm text-danger mb-4">{error}</p>}

      {adding && token && (
        <NewBlock
          token={token}
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      {loading ? (
        <div className="h-48 bg-surface-elevated rounded-xl" />
      ) : rows.length === 0 ? (
        !adding && <div className="text-center py-16 text-text-secondary text-sm">Nobody is blocked.</div>
      ) : (
        <div className="space-y-4">
          {rows.map((p) => (
            <Person key={p.id} person={p} token={token!} onChange={load} onError={setError} />
          ))}
        </div>
      )}
    </div>
  );
}

function NewBlock({ token, onCancel, onDone }: { token: string; onCancel: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [emails, setEmails] = useState('');
  const [phones, setPhones] = useState('');
  const [addresses, setAddresses] = useState('');
  const [networks, setNetworks] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await adminCreateBlocked(token, {
        name,
        reason: reason || undefined,
        emails: lines(emails),
        phones: lines(phones),
        addresses: lines(addresses),
        networks: lines(networks),
      });
      if (r.taken.length) window.alert(`Already on another person's list, so not added here: ${r.taken.join(', ')}`);
      onDone();
    } catch (err) {
      setError(apiError(err).message);
      setSaving(false);
    }
  };

  return (
    <Card className="mb-6">
      <form onSubmit={submit}>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="b-name">
            <TextInput id="b-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </Field>
          <Field label="Reason" htmlFor="b-reason" help="For the team. Never shown to them.">
            <TextInput id="b-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
          <Field label="Emails" htmlFor="b-emails" help="One per line. Gmail dots and +tags count as the same inbox.">
            <TextArea id="b-emails" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} />
          </Field>
          <Field label="Phones" htmlFor="b-phones" help="One per line, any format.">
            <TextArea id="b-phones" rows={3} value={phones} onChange={(e) => setPhones(e.target.value)} />
          </Field>
          <Field label="Delivery addresses" htmlFor="b-addresses" help="One per line, ending with the postcode.">
            <TextArea id="b-addresses" rows={3} value={addresses} onChange={(e) => setAddresses(e.target.value)} />
          </Field>
          <Field label="IP addresses" htmlFor="b-networks" help="One per line. An IPv6 blocks its whole /64.">
            <TextArea id="b-networks" rows={3} value={networks} onChange={(e) => setNetworks(e.target.value)} />
          </Field>
        </CardBody>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 sm:px-6 py-3">
          {error && <p className="mr-auto text-sm text-danger">{error}</p>}
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? 'Blocking…' : 'Block'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Person({
  person: p,
  token,
  onChange,
  onError,
}: {
  person: BlockedCustomerRow;
  token: string;
  onChange: () => void;
  onError: (m: string) => void;
}) {
  const [kind, setKind] = useState<BlockKind>('EMAIL');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChange();
    } catch (err) {
      onError(apiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    run(async () => {
      await adminAddBlockEntry(token, p.id, kind, value);
      setValue('');
    });
  };

  const unblock = () => {
    if (!window.confirm(`Unblock ${p.name}? Everything on their list is removed and their accounts are un-banned.`)) return;
    run(() => adminDeleteBlocked(token, p.id));
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 sm:px-6 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-[16px] leading-6 font-semibold">{p.name}</h2>
          <p className="text-[13px] leading-[18px] text-text-secondary">
            {p.reason ? `${p.reason} · ` : ''}
            Blocked {formatShortDate(p.createdAt)}
            {p.createdBy ? ` by ${p.createdBy}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-[13px] text-text-secondary text-right">
            {p.hits === 0 ? 'No attempts yet' : `${p.hits} refused · last ${formatDate(p.lastHitAt!)}`}
          </p>
          <Button variant="outline" size="sm" onClick={unblock} disabled={busy}>
            Unblock
          </Button>
        </div>
      </div>

      <ul className="divide-y divide-border">
        {p.entries.map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-5 sm:px-6 py-2.5 text-sm">
            <span className="w-16 shrink-0 text-text-secondary">{KIND_LABEL[e.kind]}</span>
            <span className="min-w-0 flex-1 break-words">{e.display}</span>
            {e.auto && <span className="shrink-0 rounded-full bg-surface-elevated px-2 py-0.5 text-xs text-text-secondary">Learnt</span>}
            {e.expiresAt && (
              <span className="hidden sm:inline shrink-0 text-xs text-text-secondary">until {formatShortDate(e.expiresAt)}</span>
            )}
            <button
              type="button"
              aria-label={`Remove ${e.display}`}
              disabled={busy}
              onClick={() => run(() => adminRemoveBlockEntry(token, e.id))}
              className="shrink-0 rounded-[6px] p-1 text-text-secondary hover:bg-surface-elevated hover:text-text-primary cursor-pointer disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="flex flex-wrap gap-2 border-t border-border px-5 sm:px-6 py-3">
        <SelectInput aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as BlockKind)} className="w-auto">
          {(Object.keys(KIND_LABEL) as BlockKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </SelectInput>
        <TextInput
          aria-label="Value to add"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={kind === 'ADDRESS' ? 'Street, …, postcode' : kind === 'NETWORK' ? 'IP address' : ''}
          className="min-w-0 flex-1 basis-48"
        />
        <Button type="submit" variant="outline" disabled={busy || !value.trim()}>
          Add
        </Button>
      </form>

      {p.attempts.length > 0 && (
        <div className="border-t border-border px-5 sm:px-6 py-4">
          <h3 className="mb-2 text-sm font-medium">Recent attempts</h3>
          <ul className="space-y-2">
            {p.attempts.map((a) => (
              <li key={a.id} className="text-[13px] leading-[18px]">
                <span className="text-text-secondary">{formatDate(a.createdAt)}</span> · {a.action}
                {a.ip && <span className="text-text-secondary"> from {a.ip}</span>}
                {a.learnt.length > 0 && <span className="block text-text-secondary">Learnt {a.learnt.join(', ')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
