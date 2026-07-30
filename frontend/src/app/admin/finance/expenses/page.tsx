'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, X, Receipt } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminGetExpenses, adminCreateExpense, adminDeleteExpense, adminGetFinanceOverview,
} from '@/lib/api';
import { formatPrice, formatShortDate, cn } from '@/lib/utils';
import type { CompanyExpense, PartnerBalance, ExpenseAllocation, FundingType } from '@/types';

const ALLOCATION_LABELS: Record<ExpenseAllocation, string> = {
  OWNERSHIP: 'Split by ownership',
  SINGLE_PARTNER: 'Charged to one person',
  UNALLOCATED: 'Company absorbs',
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyForm = {
  occurredAt: todayIso(),
  category: '',
  description: '',
  amount: '',
  allocation: 'OWNERSHIP' as ExpenseAllocation,
  chargedToPartnerId: '',
  paidByPartnerId: '',
  paidByFundingType: 'ADVANCE' as FundingType,
};

export default function AdminExpensesPage() {
  const { token } = useAuth();
  const [expenses, setExpenses] = useState<CompanyExpense[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [partners, setPartners] = useState<PartnerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    Promise.all([adminGetExpenses(token), adminGetFinanceOverview(token)])
      .then(([e, o]) => {
        setExpenses(e.expenses);
        setCategories(e.categories);
        setPartners(o.partners.filter((p) => p.active));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const cents = Math.round(Number(form.amount) * 100);
  const valid =
    form.category.trim() !== '' &&
    form.description.trim() !== '' &&
    Number.isFinite(cents) && cents > 0 &&
    (form.allocation !== 'SINGLE_PARTNER' || form.chargedToPartnerId !== '');

  const submit = async () => {
    if (!token || !valid) return;
    setError('');
    setSaving(true);
    try {
      await adminCreateExpense(token, {
        occurredAt: form.occurredAt,
        category: form.category.trim(),
        description: form.description.trim(),
        amount: cents,
        allocation: form.allocation,
        chargedToPartnerId: form.allocation === 'SINGLE_PARTNER' ? form.chargedToPartnerId : null,
        paidByPartnerId: form.paidByPartnerId || null,
        // Only meaningful when a partner fronted it — this is the question that
        // decides whether the company now owes them.
        paidByFundingType: form.paidByPartnerId ? form.paidByFundingType : null,
      });
      setForm(emptyForm);
      setAdding(false);
      load();
    } catch (err) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setError(message || 'Could not save that expense.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!token || !confirm('Delete this expense? Any advance it created is removed too.')) return;
    try {
      await adminDeleteExpense(token, id);
      load();
    } catch {
      setError('Could not delete that expense.');
    }
  };

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <Link
            href="/admin/finance"
            aria-label="Back to finance"
            className="mt-1 p-1 -ml-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="font-display text-2xl font-bold">Company Spending</h1>
            <p className="text-xs text-text-muted mt-0.5">
              {expenses.length} record{expenses.length === 1 ? '' : 's'} · {formatPrice(total)} total
            </p>
          </div>
        </div>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setError(''); }}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" /> Add expense
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-surface border border-border rounded-xl p-5 mb-6">
          <h2 className="font-display font-semibold mb-4">New expense</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="e-date" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Date</label>
              <input id="e-date" type="date" value={form.occurredAt} onChange={(e) => setForm((f) => ({ ...f, occurredAt: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface" />
            </div>
            <div>
              <label htmlFor="e-amount" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">RM</span>
                <input id="e-amount" type="number" min="0" step="0.01" value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0.00"
                  className="w-full pl-10 pr-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
              </div>
            </div>
            <div>
              <label htmlFor="e-category" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Category</label>
              <input id="e-category" list="expense-categories" value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Marketing"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
              {/* Suggests categories already in use — what keeps free text from
                  fragmenting into Marketing / marketing / Ads. */}
              <datalist id="expense-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label htmlFor="e-desc" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Description</label>
              <input id="e-desc" type="text" value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="e.g. Meta ads, July"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
            </div>
            <div>
              <label htmlFor="e-alloc" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">How is it shared</label>
              <select id="e-alloc" value={form.allocation}
                onChange={(e) => setForm((f) => ({ ...f, allocation: e.target.value as ExpenseAllocation }))}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface">
                {Object.entries(ALLOCATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {form.allocation === 'SINGLE_PARTNER' && (
              <div>
                <label htmlFor="e-charged" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Charged to</label>
                <select id="e-charged" value={form.chargedToPartnerId}
                  onChange={(e) => setForm((f) => ({ ...f, chargedToPartnerId: e.target.value }))}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface">
                  <option value="">Choose…</option>
                  {partners.map((p) => <option key={p.partnerId} value={p.partnerId}>{p.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="e-paidby" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">Who paid</label>
              <select id="e-paidby" value={form.paidByPartnerId}
                onChange={(e) => setForm((f) => ({ ...f, paidByPartnerId: e.target.value }))}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface">
                <option value="">Company account</option>
                {partners.map((p) => <option key={p.partnerId} value={p.partnerId}>{p.name}</option>)}
              </select>
            </div>
            {form.paidByPartnerId && (
              <div>
                <label htmlFor="e-funding" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">
                  Do they get it back?
                </label>
                <select id="e-funding" value={form.paidByFundingType}
                  onChange={(e) => setForm((f) => ({ ...f, paidByFundingType: e.target.value as FundingType }))}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface">
                  <option value="ADVANCE">Yes — company owes them back</option>
                  <option value="CONTRIBUTION">No — pure investment</option>
                </select>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-danger mt-4">{error}</p>}

          <div className="flex items-center gap-2 mt-5">
            <button onClick={submit} disabled={!valid || saving}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
              {saving ? 'Saving…' : 'Add expense'}
            </button>
            <button onClick={() => { setAdding(false); setForm(emptyForm); setError(''); }}
              className="px-3 py-2 text-sm font-medium text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-16 bg-surface-elevated rounded-xl" />)}
        </div>
      ) : expenses.length === 0 ? (
        <div className="text-center py-16">
          <Receipt className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-muted mb-1">No company spending recorded.</p>
          <p className="text-sm text-text-muted">
            Until it&rsquo;s here, every per-person profit figure is an overstatement.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="bg-surface-elevated text-xs font-medium text-text-muted uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Date</th>
                  <th className="text-left px-3 py-3">Category</th>
                  <th className="text-left px-3 py-3">Description</th>
                  <th className="text-left px-3 py-3">Shared</th>
                  <th className="text-left px-3 py-3">Paid by</th>
                  <th className="text-right px-3 py-3">Amount</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {expenses.map((e) => (
                  <tr key={e.id} className="hover:bg-surface-elevated/50 transition-colors">
                    <td className="px-5 py-3 text-text-muted whitespace-nowrap">{formatShortDate(e.occurredAt)}</td>
                    <td className="px-3 py-3">
                      <span className="px-2 py-0.5 rounded-full bg-surface-elevated text-xs">{e.category}</span>
                    </td>
                    <td className="px-3 py-3 font-medium">{e.description}</td>
                    <td className="px-3 py-3 text-text-secondary text-xs">
                      {ALLOCATION_LABELS[e.allocation]}
                      {e.chargedTo && ` · ${e.chargedTo.name}`}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      {e.paidBy ? (
                        <span>
                          {e.paidBy.name}
                          <span className={cn('block', e.funding?.type === 'ADVANCE' ? 'text-warning' : 'text-text-muted')}>
                            {e.funding?.type === 'ADVANCE' ? 'owed back' : 'investment'}
                          </span>
                        </span>
                      ) : (
                        <span className="text-text-muted">Company</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums whitespace-nowrap">{formatPrice(e.amount)}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => remove(e.id)} aria-label={`Delete ${e.description}`}
                        className="p-1 rounded-lg text-text-muted hover:text-danger transition-colors cursor-pointer">
                        <X className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
