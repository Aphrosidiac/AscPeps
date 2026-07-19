'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, X, Search, Trash2, Upload, ImageIcon, ArrowUp, ArrowDown, ArrowUpDown, RotateCcw, ChevronDown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetProducts, adminCreateProduct, adminUpdateProduct, adminDeleteProduct, adminUploadImage, getCategories } from '@/lib/api';
import { formatPrice, getDefaultVariant } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { CheckboxList } from '@/components/ui/CheckboxList';
import { FeaturedOrderModal } from './FeaturedOrderModal';
import type { Product, Category } from '@/types';

interface VariantFormData {
  id?: string;
  code: string;
  size: string;
  price: string;
  salePrice: string;
  saleStartsAt: string;
  saleEndsAt: string;
  stock: string;
  imageUrl: string;
  active: boolean;
}

interface ProductFormData {
  name: string;
  slug: string;
  categoryId: string;
  description: string;
  benefits: string;
  dosageInfo: string;
  coaUrl: string;
  featured: boolean;
  active: boolean;
  addOnIds: string[];
  // Per-selected-add-on config, keyed by addOnId (a variant id) — required/quantity
  // only meaningful for ids also present in addOnIds.
  addOnConfig: Record<string, { required: boolean; quantity: string }>;
  addOnReminder: string;
  variants: VariantFormData[];
}

const DEFAULT_COA = 'https://verify.janoshik.com/tests/155584-Blind_GLP_C5AGHBRFFNYY';

const emptyVariant: VariantFormData = {
  code: '', size: '', price: '', salePrice: '', saleStartsAt: '', saleEndsAt: '', stock: '0', imageUrl: '', active: true,
};

const emptyForm: ProductFormData = {
  name: '', slug: '', categoryId: '',
  description: '', benefits: '', dosageInfo: '', coaUrl: DEFAULT_COA,
  featured: false, active: true,
  addOnIds: [], addOnConfig: {}, addOnReminder: '',
  variants: [{ ...emptyVariant }],
};

type SortKey = 'name' | 'category' | 'price' | 'stock' | 'status';
type StatusFilter = 'all' | 'active' | 'inactive';
type FeaturedFilter = 'all' | 'featured' | 'not-featured';
type StockFilter = 'all' | 'in-stock' | 'out-of-stock';

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function totalStock(product: Product): number {
  return product.variants.filter((v) => v.active).reduce((sum, v) => sum + v.stock, 0);
}

function SortHeader({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  dir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const isActive = sortKey === activeKey;
  const Icon = isActive ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  const alignClass = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';

  return (
    <th className={`px-4 py-3 font-medium text-text-secondary ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'}`}>
      <button
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 cursor-pointer hover:text-text-primary transition-colors w-full ${alignClass}`}
      >
        {label}
        <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-text-primary' : 'text-text-muted'}`} />
      </button>
    </th>
  );
}

function FilterSelect({
  value,
  onChange,
  children,
  active,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  active: boolean;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none pl-3 pr-8 py-2 rounded-lg border text-sm bg-surface cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors ${
          active ? 'border-primary text-text-primary font-medium' : 'border-border text-text-secondary'
        }`}
      >
        {children}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
    </div>
  );
}

export default function AdminProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showFeaturedOrder, setShowFeaturedOrder] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [featuredFilter, setFeaturedFilter] = useState<FeaturedFilter>('all');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Fetched once, unfiltered — the catalog is small enough (~40 product
  // lines) that search/category/status/featured/stock filters all run
  // client-side in `displayedProducts` below rather than round-tripping to
  // the server. The add-ons picker also uses `products` directly.
  const load = () => {
    if (!token) return;
    adminGetProducts(token, { limit: '100' })
      .then((r) => setProducts(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token]);
  useEffect(() => { getCategories().then(setCategories).catch(() => {}); }, []);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const resetFilters = () => {
    setCategoryFilter('');
    setStatusFilter('all');
    setFeaturedFilter('all');
    setStockFilter('all');
  };

  const filtersActive = categoryFilter !== '' || statusFilter !== 'all' || featuredFilter !== 'all' || stockFilter !== 'all';

  // Flattens every OTHER product's active variants into add-on picker
  // options — an add-on now points at a specific sellable variant (e.g.
  // "Bac Water — 3mL"), not a whole product line.
  const addOnOptions = useMemo(() => {
    return products
      .filter((p) => p.id !== editingId)
      .flatMap((p) => p.variants.filter((v) => v.active).map((v) => ({
        id: v.id,
        label: `${p.name}${v.size ? ` — ${v.size}` : ''}`,
      })));
  }, [products, editingId]);

  const displayedProducts = useMemo(() => {
    let list = products;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.variants.some((v) => v.code.toLowerCase().includes(q)));
    }
    if (categoryFilter) list = list.filter((p) => p.categoryId === categoryFilter);
    if (statusFilter !== 'all') list = list.filter((p) => (statusFilter === 'active' ? p.active : !p.active));
    if (featuredFilter !== 'all') list = list.filter((p) => (featuredFilter === 'featured' ? p.featured : !p.featured));
    if (stockFilter !== 'all') list = list.filter((p) => (stockFilter === 'in-stock' ? totalStock(p) > 0 : totalStock(p) === 0));

    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'category': cmp = a.category.name.localeCompare(b.category.name); break;
        case 'price': cmp = (getDefaultVariant(a)?.price ?? 0) - (getDefaultVariant(b)?.price ?? 0); break;
        case 'stock': cmp = totalStock(a) - totalStock(b); break;
        case 'status': cmp = Number(a.active) - Number(b.active); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [products, search, categoryFilter, statusFilter, featuredFilter, stockFilter, sortKey, sortDir]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (product: Product) => {
    setEditingId(product.id);
    let benefits: string[] = [];
    try { if (product.benefits) benefits = JSON.parse(product.benefits); } catch {}
    setForm({
      name: product.name,
      slug: product.slug,
      categoryId: product.categoryId,
      description: product.description || '',
      benefits: benefits.join('\n'),
      dosageInfo: product.dosageInfo || '',
      coaUrl: product.coaUrl || DEFAULT_COA,
      featured: product.featured,
      active: product.active,
      addOnIds: product.addOns?.map((a) => a.id) || [],
      addOnConfig: Object.fromEntries(
        (product.addOns || []).map((a) => [a.id, { required: a.addOnRequired, quantity: String(a.addOnQuantity) }])
      ),
      addOnReminder: product.addOnReminder || '',
      variants: product.variants.map((v) => ({
        id: v.id,
        code: v.code,
        size: v.size || '',
        price: String(v.price / 100),
        salePrice: v.salePrice != null ? String(v.salePrice / 100) : '',
        saleStartsAt: v.saleStartsAt ? v.saleStartsAt.slice(0, 16) : '',
        saleEndsAt: v.saleEndsAt ? v.saleEndsAt.slice(0, 16) : '',
        stock: String(v.stock),
        imageUrl: v.imageUrl || '',
        active: v.active,
      })),
    });
    setFormError('');
    setShowModal(true);
  };

  const updateVariant = (index: number, field: keyof VariantFormData, value: string | boolean) => {
    setForm((f) => ({
      ...f,
      variants: f.variants.map((v, i) => (i === index ? { ...v, [field]: value } : v)),
    }));
  };

  const addVariantRow = () => setForm((f) => ({ ...f, variants: [...f.variants, { ...emptyVariant }] }));
  const removeVariantRow = (index: number) => setForm((f) => ({ ...f, variants: f.variants.filter((_, i) => i !== index) }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setFormError('');

    if (form.variants.length === 0) {
      setFormError('At least one variant (size) is required');
      setSaving(false);
      return;
    }

    const variantsPayload = [];
    for (const v of form.variants) {
      const priceInSen = Math.round(parseFloat(v.price) * 100);
      if (!v.code.trim() || isNaN(priceInSen) || priceInSen < 0) {
        setFormError(`Each variant needs a code and a valid price (check "${v.code || v.size || 'a new variant'}")`);
        setSaving(false);
        return;
      }
      let salePriceInSen: number | null = null;
      if (v.salePrice.trim()) {
        salePriceInSen = Math.round(parseFloat(v.salePrice) * 100);
        if (isNaN(salePriceInSen) || salePriceInSen < 0) {
          setFormError(`Invalid sale price for "${v.code}"`);
          setSaving(false);
          return;
        }
      }
      const saleStartsAtIso = v.saleStartsAt ? new Date(v.saleStartsAt).toISOString() : null;
      const saleEndsAtIso = v.saleEndsAt ? new Date(v.saleEndsAt).toISOString() : null;
      if (saleStartsAtIso && saleEndsAtIso && saleStartsAtIso > saleEndsAtIso) {
        setFormError(`Sale end date must be on or after the start date for "${v.code}"`);
        setSaving(false);
        return;
      }
      variantsPayload.push({
        ...(v.id ? { id: v.id } : {}),
        code: v.code.trim(),
        size: v.size || undefined,
        price: priceInSen,
        salePrice: salePriceInSen,
        saleStartsAt: saleStartsAtIso,
        saleEndsAt: saleEndsAtIso,
        stock: parseInt(v.stock) || 0,
        imageUrl: v.imageUrl || null,
        active: v.active,
      });
    }

    const benefitsArray = form.benefits.split('\n').map((b) => b.trim()).filter(Boolean);

    const payload = {
      name: form.name,
      slug: form.slug || slugify(form.name),
      categoryId: form.categoryId,
      description: form.description || undefined,
      benefits: benefitsArray.length > 0 ? JSON.stringify(benefitsArray) : undefined,
      dosageInfo: form.dosageInfo || undefined,
      coaUrl: form.coaUrl || null,
      featured: form.featured,
      active: form.active,
      addOns: form.addOnIds.map((addOnId) => {
        const config = form.addOnConfig[addOnId];
        const quantity = parseInt(config?.quantity ?? '1');
        return {
          addOnId,
          required: config?.required ?? false,
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        };
      }),
      addOnReminder: form.addOnReminder.trim() || null,
      variants: variantsPayload,
    };

    try {
      if (editingId) {
        await adminUpdateProduct(token, editingId, payload);
      } else {
        await adminCreateProduct(token, payload);
      }
      setShowModal(false);
      load();
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setFormError(message || 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (product: Product) => {
    if (!token) return;
    await adminUpdateProduct(token, product.id, { active: !product.active });
    load();
  };

  const handleDelete = async (product: Product) => {
    if (!token || !confirm(`Deactivate "${product.name}"? Its variants stay as-is, but the page will no longer be visible.`)) return;
    await adminDeleteProduct(token, product.id);
    load();
  };

  const updateField = (field: keyof ProductFormData, value: string | boolean) => {
    setForm((f) => {
      const updated = { ...f, [field]: value };
      if (field === 'name' && !editingId) {
        updated.slug = slugify(String(value));
      }
      return updated;
    });
  };

  const uploadVariantImage = async (index: number, file: File) => {
    if (!token) return;
    try {
      const { url } = await adminUploadImage(token, file);
      updateVariant(index, 'imageUrl', url);
    } catch {
      setFormError('Failed to upload image');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-bold">Products</h1>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setShowFeaturedOrder(true)}><ArrowUpDown className="w-4 h-4" /> Manage Featured Order</Button>
          <Button onClick={openCreate}><Plus className="w-4 h-4" /> Add Product</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            placeholder="Search by name or code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>

        <FilterSelect value={categoryFilter} onChange={setCategoryFilter} active={categoryFilter !== ''}>
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </FilterSelect>

        <FilterSelect value={statusFilter} onChange={(v) => setStatusFilter(v as StatusFilter)} active={statusFilter !== 'all'}>
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </FilterSelect>

        <FilterSelect value={featuredFilter} onChange={(v) => setFeaturedFilter(v as FeaturedFilter)} active={featuredFilter !== 'all'}>
          <option value="all">Featured &amp; Not Featured</option>
          <option value="featured">Featured Only</option>
          <option value="not-featured">Not Featured</option>
        </FilterSelect>

        <FilterSelect value={stockFilter} onChange={(v) => setStockFilter(v as StockFilter)} active={stockFilter !== 'all'}>
          <option value="all">All Stock Levels</option>
          <option value="in-stock">In Stock</option>
          <option value="out-of-stock">Out of Stock</option>
        </FilterSelect>

        {filtersActive && (
          <button
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-text-secondary hover:text-text-primary cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 bg-surface-elevated rounded" />)}
        </div>
      ) : products.length === 0 ? (
        <p className="text-text-muted py-8 text-center">No products found.</p>
      ) : displayedProducts.length === 0 ? (
        <p className="text-text-muted py-8 text-center">No products match the current filters.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-elevated">
                <SortHeader label="Name" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Category" sortKey="category" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-left font-medium text-text-secondary">Variants</th>
                <SortHeader label="Price" sortKey="price" activeKey={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Stock" sortKey="stock" activeKey={sortKey} dir={sortDir} onSort={handleSort} align="center" />
                <SortHeader label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={handleSort} align="center" />
                <th className="text-center px-4 py-3 font-medium text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedProducts.map((product) => {
                const defaultVariant = getDefaultVariant(product);
                const activeVariants = product.variants.filter((v) => v.active);
                const distinctPrices = new Set(activeVariants.map((v) => v.price)).size;
                return (
                  <tr key={product.id} className="border-b border-border last:border-0 hover:bg-surface-elevated/50">
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded bg-surface-elevated overflow-hidden shrink-0 flex items-center justify-center">
                          {defaultVariant?.imageUrl ? (
                            <img src={defaultVariant.imageUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-[8px] font-bold text-text-muted">{defaultVariant?.code ?? '—'}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {product.name}
                          {product.featured && <span className="text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded font-medium shrink-0">Featured</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-secondary text-xs">{product.category.name}</td>
                    <td className="px-4 py-3 text-text-secondary text-xs">
                      {activeVariants.length > 0
                        ? activeVariants.map((v) => v.size || v.code).join(', ')
                        : <span className="text-danger">No active variants</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {defaultVariant ? (distinctPrices > 1 ? `From ${formatPrice(defaultVariant.price)}` : formatPrice(defaultVariant.price)) : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">{totalStock(product)}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => handleToggleActive(product)} className="cursor-pointer">
                        <Badge className={product.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                          {product.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(product)} className="p-1.5 hover:bg-surface-elevated rounded cursor-pointer" title="Edit">
                          <Pencil className="w-4 h-4 text-text-muted" />
                        </button>
                        <button onClick={() => handleDelete(product)} className="p-1.5 hover:bg-red-50 rounded cursor-pointer" title="Deactivate">
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
      )}

      {/* Product Form Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-surface rounded-xl border border-border w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h2 className="font-display font-semibold text-lg">{editingId ? 'Edit Product' : 'Add New Product'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-surface-elevated rounded cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="Product Name" id="name" value={form.name} onChange={(e) => updateField('name', e.target.value)} placeholder="e.g. GHK-Cu" required />
                <Input label="URL Slug" id="slug" value={form.slug} onChange={(e) => updateField('slug', e.target.value)} placeholder="Auto-generated" required />
              </div>

              <Select
                label="Category"
                id="categoryId"
                value={form.categoryId}
                onChange={(e) => updateField('categoryId', e.target.value)}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                required
              />

              {/* Variants (sizes/SKUs) */}
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-text-secondary">Variants (sizes)</label>
                  <Button type="button" variant="outline" size="sm" onClick={addVariantRow}><Plus className="w-3.5 h-3.5" /> Add Variant</Button>
                </div>

                {form.variants.map((v, i) => (
                  <div key={v.id ?? `new-${i}`} className="space-y-2 rounded-lg border border-border p-3 bg-surface-elevated/30">
                    <div className="flex items-start gap-3">
                      <div className="w-14 h-14 rounded-lg border border-border bg-surface-elevated flex items-center justify-center overflow-hidden shrink-0">
                        {v.imageUrl ? (
                          <img src={v.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon className="w-5 h-5 text-text-muted" />
                        )}
                      </div>
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <Input label="Code" value={v.code} onChange={(e) => updateVariant(i, 'code', e.target.value)} placeholder="e.g. CU50" required />
                        <Input label="Size" value={v.size} onChange={(e) => updateVariant(i, 'size', e.target.value)} placeholder="e.g. 50mg" />
                        <Input label="Price (RM)" type="number" step="0.01" min="0" value={v.price} onChange={(e) => updateVariant(i, 'price', e.target.value)} required />
                        <Input label="Stock" type="number" min="0" value={v.stock} onChange={(e) => updateVariant(i, 'stock', e.target.value)} />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeVariantRow(i)}
                        className="p-1.5 hover:bg-red-50 rounded cursor-pointer shrink-0"
                        title="Remove variant"
                      >
                        <Trash2 className="w-4 h-4 text-text-muted hover:text-danger" />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        label="Sale Price (RM)"
                        type="number"
                        step="0.01"
                        min="0"
                        value={v.salePrice}
                        onChange={(e) => updateVariant(i, 'salePrice', e.target.value)}
                        placeholder="No sale"
                      />
                      <Input
                        label="Sale Starts"
                        type="datetime-local"
                        value={v.saleStartsAt}
                        onChange={(e) => updateVariant(i, 'saleStartsAt', e.target.value)}
                      />
                      <Input
                        label="Sale Ends"
                        type="datetime-local"
                        value={v.saleEndsAt}
                        onChange={(e) => updateVariant(i, 'saleEndsAt', e.target.value)}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-surface-elevated hover:bg-border rounded-lg text-xs font-medium cursor-pointer transition-colors">
                        <Upload className="w-3.5 h-3.5" />
                        {v.imageUrl ? 'Replace Image' : 'Upload Image'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (file) await uploadVariantImage(i, file);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input
                          type="checkbox"
                          checked={v.active}
                          onChange={(e) => updateVariant(i, 'active', e.target.checked)}
                          className="rounded"
                        />
                        Active
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <CheckboxList
                label="Add-Ons (shown on this product's page)"
                items={addOnOptions}
                selectedIds={form.addOnIds}
                onChange={(addOnIds) =>
                  setForm((f) => ({
                    ...f,
                    addOnIds,
                    addOnConfig: Object.fromEntries(
                      addOnIds.map((id) => [id, f.addOnConfig[id] ?? { required: false, quantity: '1' }])
                    ),
                  }))
                }
                searchPlaceholder="Search products..."
                emptyMessage="No other products available."
              />

              {form.addOnIds.length > 0 && (
                <div className="space-y-1.5 rounded-lg border border-border p-3">
                  <p className="text-xs font-medium text-text-secondary">Add-on settings</p>
                  {form.addOnIds.map((id) => {
                    const option = addOnOptions.find((o) => o.id === id);
                    const config = form.addOnConfig[id] ?? { required: false, quantity: '1' };
                    return (
                      <div key={id} className="flex items-center gap-3 text-sm">
                        <span className="flex-1 truncate">{option?.label ?? id}</span>
                        <label className="flex items-center gap-1.5 shrink-0 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={config.required}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                addOnConfig: { ...f.addOnConfig, [id]: { ...config, required: e.target.checked } },
                              }))
                            }
                            className="rounded accent-primary"
                          />
                          Required
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={config.quantity}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              addOnConfig: { ...f.addOnConfig, [id]: { ...config, quantity: e.target.value } },
                            }))
                          }
                          className="w-16 shrink-0 text-center py-1 border border-border rounded text-sm bg-surface"
                          title="Quantity added when this add-on is included"
                        />
                      </div>
                    );
                  })}
                </div>
              )}

              <Input
                label="Certificate of Analysis URL"
                id="coaUrl"
                value={form.coaUrl}
                onChange={(e) => updateField('coaUrl', e.target.value)}
                placeholder="https://verify.janoshik.com/tests/..."
              />

              <div>
                <label htmlFor="description" className="block text-sm font-medium text-text-secondary mb-1">Description</label>
                <textarea
                  id="description"
                  value={form.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="Product description..."
                />
              </div>

              <div>
                <label htmlFor="benefits" className="block text-sm font-medium text-text-secondary mb-1">Benefits (one per line)</label>
                <textarea
                  id="benefits"
                  value={form.benefits}
                  onChange={(e) => updateField('benefits', e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder={"Stimulates collagen production\nReduces fine lines\nPromotes wound healing"}
                />
              </div>

              <div>
                <label htmlFor="dosageInfo" className="block text-sm font-medium text-text-secondary mb-1">Dosage Info</label>
                <textarea
                  id="dosageInfo"
                  value={form.dosageInfo}
                  onChange={(e) => updateField('dosageInfo', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="Dosage instructions..."
                />
              </div>

              <div>
                <label htmlFor="addOnReminder" className="block text-sm font-medium text-text-secondary mb-1">
                  Add-on reminder (optional, plain text nudge shown near Add to Cart)
                </label>
                <Input
                  id="addOnReminder"
                  value={form.addOnReminder}
                  onChange={(e) => updateField('addOnReminder', e.target.value)}
                  placeholder="e.g. Remember: this peptide needs Bacteriostatic Water to reconstitute"
                />
              </div>

              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="featured" checked={form.featured} onChange={(e) => updateField('featured', e.target.checked)} className="rounded accent-yellow-500" />
                  <label htmlFor="featured" className="text-sm font-medium text-text-secondary flex items-center gap-1">
                    Featured
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" id="active" checked={form.active} onChange={(e) => updateField('active', e.target.checked)} className="rounded" />
                  <label htmlFor="active" className="text-sm font-medium text-text-secondary">Active (visible on store)</label>
                </div>
              </div>

              {formError && <p className="text-sm text-danger">{formError}</p>}

              <div className="flex justify-end gap-3 pt-4 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update Product' : 'Create Product'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showFeaturedOrder && token && (
        <FeaturedOrderModal
          products={products}
          token={token}
          onClose={() => setShowFeaturedOrder(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
