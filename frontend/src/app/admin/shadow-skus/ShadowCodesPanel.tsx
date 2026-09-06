'use client';

import { useState } from 'react';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminCreateShadowSku, adminDeleteShadowSku, adminUpdateShadowSku } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ShadowSku } from '@/types';

/**
 * The shadow catalogue: the codes themselves, as opposed to what they are
 * mapped to.
 *
 * Renaming is inline and first-class. A shadow name is prose that gets printed,
 * so it gets edited — and without this the only way to fix a typo would be to
 * delete the code, which the API refuses the moment anything is mapped to it.
 *
 * Deactivating is presented as the primary retirement action and deleting as
 * the exception, because a code with SKUs on it cannot be deleted at all and
 * leading with Delete would mean most clicks on it end in an error message.
 */

interface Draft {
  code: string;
  name: string;
  description: string;
}

export function ShadowCodesPanel({
  shadows,
  onChanged,
}: {
  shadows: ShadowSku[];
  onChanged: () => void;
}) {
  const { token } = useAuth();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ code: '', name: '', description: '' });

  const fail = (e: unknown, fallback: string) => {
    const err = e as { response?: { data?: { error?: string; details?: { message: string }[] } } };
    setError(err.response?.data?.error ?? err.response?.data?.details?.[0]?.message ?? fallback);
  };

  const create = async () => {
    if (!token || !code.trim() || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await adminCreateShadowSku(token, {
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || null,
      });
      setCode('');
      setName('');
      setDescription('');
      onChanged();
    } catch (e) {
      fail(e, 'Could not create that code.');
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (s: ShadowSku) => {
    setError('');
    setEditingId(s.id);
    setDraft({ code: s.code, name: s.name, description: s.description ?? '' });
  };

  const saveEdit = async (s: ShadowSku) => {
    if (!token || !draft.code.trim() || !draft.name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await adminUpdateShadowSku(token, s.id, {
        code: draft.code.trim(),
        name: draft.name.trim(),
        description: draft.description.trim() || null,
      });
      setEditingId(null);
      onChanged();
    } catch (e) {
      fail(e, 'Could not rename that code.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (s: ShadowSku) => {
    if (!token) return;
    setError('');
    try {
      await adminUpdateShadowSku(token, s.id, { active: !s.active });
      onChanged();
    } catch (e) {
      fail(e, 'Could not update that code.');
    }
  };

  const remove = async (s: ShadowSku) => {
    if (!token) return;
    if (!confirm(`Delete ${s.code}? This only works while no SKU is mapped to it.`)) return;
    setError('');
    try {
      await adminDeleteShadowSku(token, s.id);
      onChanged();
    } catch (e) {
      fail(e, 'Could not delete that code.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl border border-border bg-surface-elevated">
        <h2 className="text-sm font-semibold mb-1">New shadow code</h2>
        <p className="text-xs text-text-muted mb-3">
          Keep the size in the name — <span className="font-mono">Research peptide, 10mg vial</span>{' '}
          reads on its own, where a bare code makes whoever picks up the sheet go looking for a
          mapping they probably do not have.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. LR-0042"
            aria-label="Shadow code"
            className="px-3 py-2 border border-border rounded-lg text-sm bg-surface font-mono"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Research peptide, 10mg vial"
            aria-label="Shadow name"
            className="px-3 py-2 border border-border rounded-lg text-sm bg-surface"
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Longer description (optional)"
            aria-label="Shadow description"
            className="sm:col-span-2 px-3 py-2 border border-border rounded-lg text-sm bg-surface"
          />
        </div>
        <button
          onClick={create}
          disabled={busy || !code.trim() || !name.trim()}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-primary-light transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" /> Add code
        </button>
      </div>

      {error && <p className="px-3 py-2 rounded-lg bg-danger/10 text-danger text-xs">{error}</p>}

      {shadows.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-8 text-center">
          <p className="text-sm text-text-secondary">No shadow codes yet.</p>
          <p className="text-xs text-text-muted mt-1">
            Add one above, then map SKUs to it on the Mapping tab.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-xl">
          <table className="w-full text-sm min-w-[38rem]">
            <thead className="bg-surface-elevated text-text-muted text-xs">
              <tr>
                <th className="p-3 text-left font-medium w-40">Code</th>
                <th className="p-3 text-left font-medium">Name</th>
                <th className="p-3 text-right font-medium w-20">SKUs</th>
                <th className="p-3 text-right font-medium w-24">Status</th>
                <th className="p-3 w-24" />
              </tr>
            </thead>
            <tbody>
              {shadows.map((s) => {
                const editing = editingId === s.id;
                return (
                  <tr key={s.id} className={cn('border-t border-border', !s.active && !editing && 'opacity-60')}>
                    <td className="p-3 align-top">
                      {editing ? (
                        <input
                          value={draft.code}
                          onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                          aria-label="Code"
                          className="w-full px-2 py-1.5 border border-border rounded-lg text-xs bg-surface font-mono"
                        />
                      ) : (
                        <span className="font-mono text-xs">{s.code}</span>
                      )}
                    </td>
                    <td className="p-3 align-top">
                      {editing ? (
                        <div className="space-y-1.5">
                          <input
                            value={draft.name}
                            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            aria-label="Name"
                            className="w-full px-2 py-1.5 border border-border rounded-lg text-sm bg-surface"
                          />
                          <input
                            value={draft.description}
                            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                            aria-label="Description"
                            placeholder="Longer description (optional)"
                            className="w-full px-2 py-1.5 border border-border rounded-lg text-xs bg-surface"
                          />
                        </div>
                      ) : (
                        <>
                          <span className="font-medium">{s.name}</span>
                          {s.description && (
                            <span className="block text-xs text-text-muted">{s.description}</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="p-3 text-right tabular-nums text-text-muted align-top">
                      {s.variantCount}
                    </td>
                    <td className="p-3 text-right align-top">
                      <button
                        onClick={() => toggleActive(s)}
                        disabled={editing}
                        title={s.active ? 'Deactivate — hides it from the assignment dropdowns' : 'Reactivate'}
                        className={cn(
                          'px-2 py-1 rounded-full text-[11px] font-medium cursor-pointer transition-colors disabled:opacity-40',
                          s.active
                            ? 'bg-success/10 text-success hover:bg-success/20'
                            : 'bg-surface-elevated text-text-muted hover:bg-border',
                        )}
                      >
                        {s.active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="p-3 text-right align-top whitespace-nowrap">
                      {editing ? (
                        <>
                          <button
                            onClick={() => saveEdit(s)}
                            disabled={busy || !draft.code.trim() || !draft.name.trim()}
                            aria-label="Save"
                            className="p-1.5 rounded-lg text-success hover:bg-success/10 disabled:opacity-40 transition-colors cursor-pointer"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            aria-label="Cancel"
                            className="p-1.5 rounded-lg text-text-muted hover:bg-surface-elevated transition-colors cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(s)}
                            aria-label={`Edit ${s.code}`}
                            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => remove(s)}
                            aria-label={`Delete ${s.code}`}
                            title={s.variantCount > 0 ? 'Mapped to SKUs — deactivate instead' : 'Delete'}
                            className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
