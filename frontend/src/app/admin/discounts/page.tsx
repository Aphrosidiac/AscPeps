'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Search, X, Tag, Percent, DollarSign } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetDiscounts, adminCreateDiscount, adminUpdateDiscount, adminDeleteDiscount } from '@/lib/api';
import { formatPrice, formatDate, cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Animate } from '@/components/ui/Animate';

interface Discount {
  id: string;
  code: string;
  description?: string;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: number;
  minOrderAmount?: number;
  maxUses?: number;
  usedCount: number;
  isActive: boolean;
  expiresAt?: string;
  createdAt: string;
}

interface DiscountFormData {
  code: string;
  description: string;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discountValue: string;
  minOrderAmount: string;
  maxUses: string;
  expiresAt: string;
  isActive: boolean;
}

const emptyForm: DiscountFormData = {
  code: '',
  description: '',
  discountType: 'PERCENTAGE',
  discountValue: '',
  minOrderAmount: '',
  maxUses: '',
  expiresAt: '',
  isActive: true,
};

function getDiscountStatus(discount: Discount): { label: string; color: string } {
  if (!discount.isActive) {
    return { label: 'Inactive', color: 'bg-gray-100 text-gray-700' };
  }
  if (discount.expiresAt && new Date(discount.expiresAt) < new Date()) {
    return { label: 'Expired', color: 'bg-amber-100 text-amber-800' };
  }
  if (discount.maxUses && discount.usedCount >= discount.maxUses) {
    return { label: 'Maxed', color: 'bg-red-100 text-red-700' };
  }
  return { label: 'Active', color: 'bg-green-100 text-green-800' };
}

function formatDiscountValue(discount: Discount): string {
  if (discount.discountType === 'PERCENTAGE') {
    return `${discount.discountValue}%`;
  }
  return formatPrice(discount.discountValue);
}

export default function AdminDiscountsPage() {
  const { token } = useAuth();
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DiscountFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Discount | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    if (!token) return;
    const params: Record<string, string> = { limit: '100' };
    if (search) params.search = search;
    adminGetDiscounts(token, params)
      .then((r) => setDiscounts(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token, search]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (discount: Discount) => {
    setEditingId(discount.id);
    setForm({
      code: discount.code,
      description: discount.description || '',
      discountType: discount.discountType,
      discountValue: discount.discountType === 'PERCENTAGE'
        ? String(discount.discountValue)
        : String(discount.discountValue / 100),
      minOrderAmount: discount.minOrderAmount ? String(discount.minOrderAmount / 100) : '',
      maxUses: discount.maxUses ? String(discount.maxUses) : '',
      expiresAt: discount.expiresAt ? discount.expiresAt.slice(0, 16) : '',
      isActive: discount.isActive,
    });
    setFormError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setFormError('');

    const discountValue = form.discountType === 'PERCENTAGE'
      ? parseFloat(form.discountValue)
      : Math.round(parseFloat(form.discountValue) * 100);

    if (isNaN(discountValue) || discountValue <= 0) {
      setFormError('Invalid discount value');
      setSaving(false);
      return;
    }

    if (form.discountType === 'PERCENTAGE' && discountValue > 100) {
      setFormError('Percentage cannot exceed 100%');
      setSaving(false);
      return;
    }

    const payload: Record<string, unknown> = {
      code: form.code.toUpperCase().trim(),
      description: form.description || undefined,
      discountType: form.discountType,
      discountValue,
      isActive: form.isActive,
    };

    if (form.minOrderAmount) {
      const minOrder = Math.round(parseFloat(form.minOrderAmount) * 100);
      if (isNaN(minOrder) || minOrder < 0) {
        setFormError('Invalid minimum order amount');
        setSaving(false);
        return;
      }
      payload.minOrderAmount = minOrder;
    } else {
      payload.minOrderAmount = null;
    }

    if (form.maxUses) {
      const maxUses = parseInt(form.maxUses);
      if (isNaN(maxUses) || maxUses < 1) {
        setFormError('Max uses must be at least 1');
        setSaving(false);
        return;
      }
      payload.maxUses = maxUses;
    } else {
      payload.maxUses = null;
    }

    if (form.expiresAt) {
      payload.expiresAt = new Date(form.expiresAt).toISOString();
    } else {
      payload.expiresAt = null;
    }

    try {
      if (editingId) {
        await adminUpdateDiscount(token, editingId, payload);
      } else {
        await adminCreateDiscount(token, payload);
      }
      setShowModal(false);
      load();
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setFormError(message || 'Failed to save discount');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!token || !deleteTarget) return;
    setDeleting(true);
    try {
      await adminDeleteDiscount(token, deleteTarget.id);
      setDeleteTarget(null);
      load();
    } catch {
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const updateField = (field: keyof DiscountFormData, value: string | boolean) => {
    setForm((f) => ({ ...f, [field]: value }));
  };

  const filtered = discounts.filter((d) =>
    d.code.toLowerCase().includes(search.toLowerCase()) ||
    (d.description && d.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div>
      <Animate variant="fadeUp">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold">Discounts</h1>
            <p className="text-sm text-text-muted mt-0.5">{discounts.length} discount code{discounts.length !== 1 ? 's' : ''}</p>
          </div>
          <Button onClick={openCreate}><Plus className="w-4 h-4" /> Add Discount</Button>
        </div>
      </Animate>

      <Animate variant="fadeUp" delay={0.05}>
        <div className="relative max-w-sm mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by code or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
      </Animate>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 bg-surface-elevated rounded" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Animate variant="fadeUp">
          <div className="text-center py-16">
            <Tag className="w-10 h-10 text-text-muted mx-auto mb-3" />
            <p className="text-text-muted text-lg mb-1">No discounts found</p>
            <p className="text-text-muted text-sm">
              {search ? 'Try a different search term.' : 'Create your first discount code to get started.'}
            </p>
          </div>
        </Animate>
      ) : (
        <Animate variant="fadeUp" delay={0.1}>
          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-elevated">
                  <th className="text-left px-3 sm:px-4 py-3 font-medium text-text-secondary">Code</th>
                  {/* Percentage-vs-fixed is already legible from the value
                      itself ("10%" vs "RM10.00"), so the column goes on a
                      phone rather than pushing Status and Actions off. */}
                  <th className="text-left px-4 py-3 font-medium text-text-secondary hidden md:table-cell">Type</th>
                  <th className="text-right px-2 sm:px-4 py-3 font-medium text-text-secondary">Value</th>
                  <th className="text-right px-4 py-3 font-medium text-text-secondary hidden sm:table-cell">Min Order</th>
                  <th className="text-center px-4 py-3 font-medium text-text-secondary hidden sm:table-cell">Usage</th>
                  <th className="text-center px-2 sm:px-4 py-3 font-medium text-text-secondary">Status</th>
                  <th className="text-center px-2 sm:px-4 py-3 font-medium text-text-secondary">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((discount) => {
                  const status = getDiscountStatus(discount);
                  return (
                    <tr key={discount.id} className="border-b border-border last:border-0 hover:bg-surface-elevated/50 transition-colors">
                      <td className="px-3 sm:px-4 py-3">
                        <div>
                          <p className="font-mono font-semibold text-xs tracking-wide break-all">{discount.code}</p>
                          {discount.description && (
                            <p className="text-xs text-text-muted mt-0.5 line-clamp-1 max-w-48">{discount.description}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex items-center gap-1.5">
                          {discount.discountType === 'PERCENTAGE' ? (
                            <Percent className="w-3.5 h-3.5 text-text-muted" />
                          ) : (
                            <DollarSign className="w-3.5 h-3.5 text-text-muted" />
                          )}
                          <span className="text-xs text-text-secondary">
                            {discount.discountType === 'PERCENTAGE' ? 'Percentage' : 'Fixed'}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 sm:px-4 py-3 text-right font-display font-semibold whitespace-nowrap">
                        {formatDiscountValue(discount)}
                      </td>
                      <td className="px-4 py-3 text-right text-text-secondary hidden sm:table-cell">
                        {discount.minOrderAmount ? formatPrice(discount.minOrderAmount) : <span className="text-text-muted">--</span>}
                      </td>
                      <td className="px-4 py-3 text-center hidden sm:table-cell">
                        <span className="text-text-secondary">
                          {discount.usedCount}
                          {discount.maxUses ? <span className="text-text-muted"> / {discount.maxUses}</span> : ''}
                        </span>
                      </td>
                      <td className="px-2 sm:px-4 py-3 text-center">
                        <Badge className={status.color}>{status.label}</Badge>
                      </td>
                      <td className="px-2 sm:px-4 py-3">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openEdit(discount)}
                            className="p-1.5 hover:bg-surface-elevated rounded cursor-pointer transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4 text-text-muted" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(discount)}
                            className="p-1.5 hover:bg-red-50 rounded cursor-pointer transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4 text-text-muted hover:text-danger" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Animate>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface rounded-xl border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 className="font-display font-semibold text-lg">
                {editingId ? 'Edit Discount' : 'Create Discount'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-surface-elevated rounded cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <Input
                label="Discount Code"
                id="code"
                value={form.code}
                onChange={(e) => updateField('code', e.target.value.toUpperCase())}
                placeholder="e.g. WELCOME20"
                className="font-mono uppercase tracking-wider"
                required
              />

              <div>
                <label htmlFor="description" className="block text-sm font-medium text-text-secondary mb-1">
                  Description
                </label>
                <textarea
                  id="description"
                  value={form.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="Optional internal description..."
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Select
                  label="Discount Type"
                  id="discountType"
                  value={form.discountType}
                  onChange={(e) => updateField('discountType', e.target.value)}
                  options={[
                    { value: 'PERCENTAGE', label: 'Percentage (%)' },
                    { value: 'FIXED_AMOUNT', label: 'Fixed Amount (RM)' },
                  ]}
                  required
                />
                <Input
                  label={form.discountType === 'PERCENTAGE' ? 'Discount (%)' : 'Discount (RM)'}
                  id="discountValue"
                  type="number"
                  step={form.discountType === 'PERCENTAGE' ? '1' : '0.01'}
                  min="0"
                  max={form.discountType === 'PERCENTAGE' ? '100' : undefined}
                  value={form.discountValue}
                  onChange={(e) => updateField('discountValue', e.target.value)}
                  placeholder={form.discountType === 'PERCENTAGE' ? 'e.g. 15' : 'e.g. 10.00'}
                  required
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Input
                  label="Min Order Amount (RM)"
                  id="minOrderAmount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.minOrderAmount}
                  onChange={(e) => updateField('minOrderAmount', e.target.value)}
                  placeholder="Optional"
                />
                <Input
                  label="Max Uses"
                  id="maxUses"
                  type="number"
                  min="1"
                  value={form.maxUses}
                  onChange={(e) => updateField('maxUses', e.target.value)}
                  placeholder="Unlimited"
                />
              </div>

              <Input
                label="Expires At"
                id="expiresAt"
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) => updateField('expiresAt', e.target.value)}
              />

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.isActive}
                  onClick={() => updateField('isActive', !form.isActive)}
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                    form.isActive ? 'bg-primary' : 'bg-border'
                  )}
                >
                  <span
                    className={cn(
                      'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                      form.isActive ? 'translate-x-5' : 'translate-x-0'
                    )}
                  />
                </button>
                <label className="text-sm font-medium text-text-secondary">
                  {form.isActive ? 'Active' : 'Inactive'}
                </label>
              </div>

              {formError && <p className="text-sm text-danger">{formError}</p>}

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update Discount' : 'Create Discount'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface rounded-xl border border-border w-full max-w-sm">
            <div className="p-6">
              <h2 className="font-display font-semibold text-lg mb-2">Delete Discount</h2>
              <p className="text-sm text-text-secondary">
                Are you sure you want to delete the discount code{' '}
                <span className="font-mono font-semibold text-text-primary">{deleteTarget.code}</span>?
                This action cannot be undone.
              </p>
              {deleteTarget.usedCount > 0 && (
                <p className="text-sm text-amber-600 mt-2">
                  This code has been used {deleteTarget.usedCount} time{deleteTarget.usedCount !== 1 ? 's' : ''}.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 px-6 pb-6">
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button type="button" variant="danger" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
