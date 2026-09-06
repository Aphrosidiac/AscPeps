'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, X, Receipt, Paperclip } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminGetExpenses, adminCreateExpense, adminUpdateExpense, adminDeleteExpense, adminGetFinanceOverview,
} from '@/lib/api';
import { AttachedDocuments } from '@/app/admin/documents/AttachedDocuments';
import { formatPrice, formatShortDate, cn } from '@/lib/utils';
import type { CompanyExpense, PartnerBalance, FundingType, ExpenseKind } from '@/types';

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyForm = {
  occurredAt: todayIso(),
  category: '',
  description: '',
  amount: '',
  kind: 'OPERATING' as ExpenseKind,
  paidByPartnerId: '',
  paidByFundingType: 'ADVANCE' as FundingType,
};

const KIND_LABEL: Record<ExpenseKind, string> = {
  OPERATING: 'Operating',
  INVENTORY: 'Stock',
};

export default function AdminExpensesPage() {
  const { token } = useAuth();
  const [expenses, setExpenses] = useState<CompanyExpense[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [partners, setPartners] = useState<PartnerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [closingForm, setClosingForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [docsFor, setDocsFor] = useState<CompanyExpense | null>(null);

  // Every setState here happens in a promise callback, never synchronously in
  // the effect body — the retry button is what re-arms `loading`.
  const load = useCallback(() => {
    if (!token) return;
    Promise.all([adminGetExpenses(token), adminGetFinanceOverview(token)])
      .then(([e, o]) => {
        setExpenses(e.expenses);
        setCategories(e.categories);
        setPartners(o.partners.filter((p) => p.active));
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [token]);

  const retry = () => { setLoading(true); setLoadFailed(false); load(); };

  useEffect(() => { load(); }, [load]);

  // Let the collapse animation finish before unmounting the form, so it
  // retracts rather than blinking out.
  const closeForm = (reset = true) => {
    setClosingForm(true);
    setTimeout(() => {
      setAdding(false);
      setClosingForm(false);
      if (reset) { setForm(emptyForm); setError(''); }
    }, 150);
  };

  const cents = Math.round(Number(form.amount) * 100);
  const valid =
    form.category.trim() !== '' &&
    form.description.trim() !== '' &&
    Number.isFinite(cents) && cents > 0;

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
        kind: form.kind,
        paidByPartnerId: form.paidByPartnerId || null,
        // Only meaningful when a partner fronted it — this is the question that
        // decides whether the company now owes them.
        paidByFundingType: form.paidByPartnerId ? form.paidByFundingType : null,
      });
      closeForm();
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

  // The whole point of the operating/stock split: every expense recorded before
  // it existed defaults to Operating, and the stock purchases among them are
  // exactly the rows that were being counted twice. Editing in place rather
  // than delete-and-recreate keeps any advance still owed to whoever paid.
  const reclassify = async (expense: CompanyExpense) => {
    if (!token) return;
    const next: ExpenseKind = expense.kind === 'INVENTORY' ? 'OPERATING' : 'INVENTORY';
    setError('');
    try {
      await adminUpdateExpense(token, expense.id, { kind: next });
      load();
    } catch {
      setError('Could not change that expense.');
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

  // A receipt is filed at the moment you are looking at the expense, not from a
  // separate page later — so the control that opens the paperwork lives on the
  // row itself, and says whether anything is there yet.
  const DocsButton = ({ expense }: { expense: CompanyExpense }) => {
    // Counted by the database on the expense itself. This used to be tallied in
    // the browser from a fetch of every document, which meant the number went
    // quietly wrong once there were more documents than one page of them.
    const count = expense._count?.documents ?? 0;
    return (
      <button
        onClick={(ev) => { ev.stopPropagation(); setDocsFor(expense); }}
        title={count ? `${count} document${count === 1 ? '' : 's'} filed` : 'No receipt filed — click to attach one'}
        aria-label={`Documents for ${expense.description}`}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs transition-colors cursor-pointer',
          count ? 'text-text-secondary hover:bg-surface-elevated' : 'text-text-muted hover:text-primary hover:bg-surface-elevated'
        )}
      >
        <Paperclip className="w-3.5 h-3.5" />
        {count > 0 && <span className="tabular-nums">{count}</span>}
      </button>
    );
  };

  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const stockTotal = expenses.reduce((sum, e) => sum + (e.kind === 'INVENTORY' ? e.amount : 0), 0);
  const operatingTotal = total - stockTotal;

  return (
    <div>
      {/* Stacks on phones: "Company Spending" plus the back arrow plus the
          button need more than 375px, and squeezing them onto one row clipped
          the button. */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-6">
        <div className="flex items-start gap-3 min-w-0">
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
              {expenses.length} record{expenses.length === 1 ? '' : 's'} · {formatPrice(operatingTotal)} operating
              {stockTotal > 0 && <> · {formatPrice(stockTotal)} stock</>}
            </p>
          </div>
        </div>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setError(''); }}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light transition-colors cursor-pointer shrink-0 self-start"
          >
            <Plus className="w-4 h-4" /> Add expense
          </button>
        )}
      </div>

      {adding && (
        <div className={cn('panel-reveal bg-surface border border-border rounded-xl p-5 mb-6', closingForm && 'is-closing')}>
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
              <label htmlFor="e-kind" className="text-xs font-medium text-text-muted uppercase tracking-wider block mb-1.5">
                What kind of spending
              </label>
              <select id="e-kind" value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as ExpenseKind }))}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-surface">
                <option value="OPERATING">Operating — used up now</option>
                <option value="INVENTORY">Stock — goods to sell later</option>
              </select>
              <p className="text-[11px] text-text-muted mt-1.5">
                {form.kind === 'INVENTORY'
                  ? 'Not counted against profit now. It becomes a cost as goods, when it sells — otherwise the same stock is charged twice.'
                  : 'Ads, software, packaging, fees. Reduces net profit today.'}
              </p>
            </div>
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
            <button onClick={() => closeForm()}
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
      ) : loadFailed ? (
        <div className="text-center py-16">
          <Receipt className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-muted mb-1">Could not load spending.</p>
          <p className="text-sm text-text-muted mb-4">The request failed or timed out.</p>
          <button onClick={retry} className="text-sm font-medium text-primary underline cursor-pointer">Try again</button>
        </div>
      ) : expenses.length === 0 ? (
        <div className="text-center py-16">
          <Receipt className="w-10 h-10 text-text-muted mx-auto mb-3" />
          <p className="text-text-muted mb-1">No company spending recorded.</p>
          <p className="text-sm text-text-muted">
            Operating spending reduces net profit. Stock does not — it becomes a cost when it sells.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {/* Cards on phones — the table needs ~760px, so Amount and the delete
              control were both off the right edge on a 375px screen. */}
          <div className="divide-y divide-border md:hidden">
            {expenses.map((e, i) => (
              <div
                key={e.id}
                style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}
                className="row-rise px-4 py-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-sm min-w-0">{e.description}</p>
                  <div className="flex items-baseline gap-1 shrink-0">
                    <DocsButton expense={e} />
                    <span className="text-sm font-semibold tabular-nums">{formatPrice(e.amount)}</span>
                    <button onClick={() => remove(e.id)} aria-label={`Delete ${e.description}`}
                      className="p-1 -mr-1 rounded-lg text-text-muted hover:text-danger transition-colors cursor-pointer">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap mt-1.5 text-xs text-text-muted">
                  <button
                    onClick={() => reclassify(e)}
                    title={e.kind === 'INVENTORY'
                      ? 'Stock — becomes a cost when it sells. Tap to make it operating spending.'
                      : 'Operating — a cost today. Tap if this bought stock instead.'}
                    className={cn(
                      'px-2 py-0.5 rounded-full cursor-pointer transition-colors',
                      e.kind === 'INVENTORY'
                        ? 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                        : 'bg-surface-elevated hover:bg-border'
                    )}
                  >
                    {KIND_LABEL[e.kind]}
                  </button>
                  <span className="px-2 py-0.5 rounded-full bg-surface-elevated">{e.category}</span>
                  <span>{formatShortDate(e.occurredAt)}</span>
                  <span>·</span>
                  {e.paidBy ? (
                    <span>
                      {e.paidBy.name}
                      <span className={cn(e.funding?.type === 'ADVANCE' ? 'text-warning' : 'text-text-muted')}>
                        {e.funding?.type === 'ADVANCE' ? ' · owed back' : ' · investment'}
                      </span>
                    </span>
                  ) : (
                    <span>Company account</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="bg-surface-elevated text-xs font-medium text-text-muted uppercase tracking-wider">
                  <th className="text-left px-5 py-3">Date</th>
                  <th className="text-left px-3 py-3">Kind</th>
                  <th className="text-left px-3 py-3">Category</th>
                  <th className="text-left px-3 py-3">Description</th>
                  <th className="text-left px-3 py-3">Paid by</th>
                  <th className="text-center px-3 py-3">Docs</th>
                  <th className="text-right px-3 py-3">Amount</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {expenses.map((e, i) => (
                  <tr
                    key={e.id}
                    // Capped so a long list still finishes arriving quickly.
                    style={{ animationDelay: `${Math.min(i * 35, 350)}ms` }}
                    className="row-rise hover:bg-surface-elevated/50 transition-colors"
                  >
                    <td className="px-5 py-3 text-text-muted whitespace-nowrap">{formatShortDate(e.occurredAt)}</td>
                    <td className="px-3 py-3">
                      {/* Click to switch. Reclassifying is the common action on
                          this column — every row entered before the split
                          existed says Operating, including the stock buys that
                          were being double-counted. */}
                      <button
                        onClick={() => reclassify(e)}
                        title={e.kind === 'INVENTORY'
                          ? 'Stock — becomes a cost when it sells. Click to make it operating spending.'
                          : 'Operating — a cost today. Click if this bought stock instead.'}
                        className={cn(
                          'px-2 py-0.5 rounded-full text-xs cursor-pointer transition-colors whitespace-nowrap',
                          e.kind === 'INVENTORY'
                            ? 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                            : 'bg-surface-elevated text-text-secondary hover:bg-border'
                        )}
                      >
                        {KIND_LABEL[e.kind]}
                      </button>
                    </td>
                    <td className="px-3 py-3">
                      <span className="px-2 py-0.5 rounded-full bg-surface-elevated text-xs">{e.category}</span>
                    </td>
                    <td className="px-3 py-3 font-medium">{e.description}</td>
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
                    <td className="px-3 py-3 text-center"><DocsButton expense={e} /></td>
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

      {/* Deliberately a panel over this page rather than a jump to Documents:
          you are checking one expense against its receipt, and losing the list
          you were working down is the wrong trade. */}
      {docsFor && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto"
          onClick={() => { setDocsFor(null); load(); }}
          role="dialog"
          aria-modal="true"
          aria-label={`Documents for ${docsFor.description}`}
        >
          <div onClick={(ev) => ev.stopPropagation()} className="w-full max-w-lg my-auto">
            <div className="flex items-center justify-between mb-3">
              <div className="min-w-0">
                <p className="text-white font-display font-semibold truncate">{docsFor.description}</p>
                <p className="text-white/70 text-xs">{docsFor.category} · {formatPrice(docsFor.amount)}</p>
              </div>
              <button
                onClick={() => { setDocsFor(null); load(); }}
                aria-label="Close"
                className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <AttachedDocuments expenseId={docsFor.id} />
          </div>
        </div>
      )}
    </div>
  );
}
