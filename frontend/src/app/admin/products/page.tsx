'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import Image from 'next/image';
import { Plus, Pencil, X, Search, Trash2, Upload, ImageIcon, ArrowUp, ArrowDown, ArrowUpDown, RotateCcw, ChevronDown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetProducts, adminCreateProduct, adminUpdateProduct, adminDeleteProduct, adminUploadImage, getCategories } from '@/lib/api';
import { formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { CheckboxList } from '@/components/ui/CheckboxList';
import { FeaturedOrderModal } from './FeaturedOrderModal';
import type { Product, Category } from '@/types';

interface ProductFormData {
  code: string;
  name: string;
  slug: string;
  categoryId: string;
  size: string;
  price: string;
  salePrice: string;
  saleStartsAt: string;
  saleEndsAt: string;
  description: string;
  benefits: string;
  dosageInfo: string;
  stock: string;
  imageUrl: string;
  coaUrl: string;
  featured: boolean;
  active: boolean;
  addOnIds: string[];
}

const DEFAULT_COA = 'https://verify.janoshik.com/tests/155584-Blind_GLP_C5AGHBRFFNYY';

const emptyForm: ProductFormData = {
  code: '', name: '', slug: '', categoryId: '', size: '',
  price: '', salePrice: '', saleStartsAt: '', saleEndsAt: '',
  description: '', benefits: '', dosageInfo: '',
  stock: '0', imageUrl: '', coaUrl: DEFAULT_COA, featured: false, active: true,
  addOnIds: [],
};

type SortKey = 'code' | 'name' | 'category' | 'size' | 'price' | 'stock' | 'status';
type StatusFilter = 'all' | 'active' | 'inactive';
type FeaturedFilter = 'all' | 'featured' | 'not-featured';
type StockFilter = 'all' | 'in-stock' | 'out-of-stock';

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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
  const stockTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [featuredFilter, setFeaturedFilter] = useState<FeaturedFilter>('all');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Fetched once, unfiltered — the catalog is small enough (~55 products)
  // that search/category/status/featured/stock filters all run client-side
  // in `displayedProducts` below rather than round-tripping to the server.
  // (Previously this page also fetched the same list a second time just for
  // the add-ons picker; that's gone too — the picker uses `products` directly.)
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

  const displayedProducts = useMemo(() => {
    let list = products;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q));
    }
    if (categoryFilter) list = list.filter((p) => p.categoryId === categoryFilter);
    if (statusFilter !== 'all') list = list.filter((p) => (statusFilter === 'active' ? p.active : !p.active));
    if (featuredFilter !== 'all') list = list.filter((p) => (featuredFilter === 'featured' ? p.featured : !p.featured));
    if (stockFilter !== 'all') list = list.filter((p) => (stockFilter === 'in-stock' ? p.stock > 0 : p.stock === 0));

    const sorted = [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'code': cmp = a.code.localeCompare(b.code); break;
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'category': cmp = a.category.name.localeCompare(b.category.name); break;
        case 'size': cmp = (a.size || '').localeCompare(b.size || '', undefined, { numeric: true }); break;
        case 'price': cmp = a.price - b.price; break;
        case 'stock': cmp = a.stock - b.stock; break;
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
      code: product.code,
      name: product.name,
      slug: product.slug,
      categoryId: product.categoryId,
      size: product.size || '',
      price: String(product.price / 100),
      salePrice: product.salePrice != null ? String(product.salePrice / 100) : '',
      saleStartsAt: product.saleStartsAt ? product.saleStartsAt.slice(0, 16) : '',
      saleEndsAt: product.saleEndsAt ? product.saleEndsAt.slice(0, 16) : '',
      description: product.description || '',
      benefits: benefits.join('\n'),
      dosageInfo: product.dosageInfo || '',
      stock: String(product.stock),
      imageUrl: product.imageUrl || '',
      coaUrl: product.coaUrl || DEFAULT_COA,
      featured: product.featured,
      active: product.active,
      addOnIds: product.addOns?.map((p) => p.id) || [],
    });
    setFormError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setFormError('');

    const priceInSen = Math.round(parseFloat(form.price) * 100);
    if (isNaN(priceInSen) || priceInSen < 0) {
      setFormError('Invalid price');
      setSaving(false);
      return;
    }

    let salePriceInSen: number | null = null;
    if (form.salePrice.trim()) {
      salePriceInSen = Math.round(parseFloat(form.salePrice) * 100);
      if (isNaN(salePriceInSen) || salePriceInSen < 0) {
        setFormError('Invalid sale price');
        setSaving(false);
        return;
      }
    }
    const saleStartsAtIso = form.saleStartsAt ? new Date(form.saleStartsAt).toISOString() : null;
    const saleEndsAtIso = form.saleEndsAt ? new Date(form.saleEndsAt).toISOString() : null;
    if (saleStartsAtIso && saleEndsAtIso && saleStartsAtIso > saleEndsAtIso) {
      setFormError('Sale end date must be on or after the start date');
      setSaving(false);
      return;
    }

    const benefitsArray = form.benefits.split('\n').map(b => b.trim()).filter(Boolean);

    const payload = {
      code: form.code,
      name: form.name,
      slug: form.slug || slugify(`${form.name}-${form.size}`),
      categoryId: form.categoryId,
      size: form.size || undefined,
      price: priceInSen,
      salePrice: salePriceInSen,
      saleStartsAt: saleStartsAtIso,
      saleEndsAt: saleEndsAtIso,
      description: form.description || undefined,
      benefits: benefitsArray.length > 0 ? JSON.stringify(benefitsArray) : undefined,
      dosageInfo: form.dosageInfo || undefined,
      stock: parseInt(form.stock) || 0,
      imageUrl: form.imageUrl || null,
      coaUrl: form.coaUrl || null,
      featured: form.featured,
      active: form.active,
      addOnIds: form.addOnIds,
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

  const handleStockChange = (product: Product, value: string) => {
    const stock = parseInt(value) || 0;
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, stock } : p));

    if (stockTimers.current[product.id]) clearTimeout(stockTimers.current[product.id]);
    stockTimers.current[product.id] = setTimeout(async () => {
      if (!token) return;
      await adminUpdateProduct(token, product.id, { stock });
    }, 800);
  };

  const handleDelete = async (product: Product) => {
    if (!token || !confirm(`Deactivate "${product.name}"?`)) return;
    await adminDeleteProduct(token, product.id);
    load();
  };

  const updateField = (field: keyof ProductFormData, value: string | boolean) => {
    setForm(f => {
      const updated = { ...f, [field]: value };
      if (field === 'name' && !editingId) {
        updated.slug = slugify(`${updated.name}-${updated.size}`);
      }
      if (field === 'size' && !editingId) {
        updated.slug = slugify(`${updated.name}-${updated.size}`);
      }
      return updated;
    });
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
                <SortHeader label="Code" sortKey="code" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Name" sortKey="name" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Category" sortKey="category" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Size" sortKey="size" activeKey={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Price" sortKey="price" activeKey={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                <SortHeader label="Stock" sortKey="stock" activeKey={sortKey} dir={sortDir} onSort={handleSort} align="center" />
                <SortHeader label="Status" sortKey="status" activeKey={sortKey} dir={sortDir} onSort={handleSort} align="center" />
                <th className="text-center px-4 py-3 font-medium text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedProducts.map((product) => (
                <tr key={product.id} className="border-b border-border last:border-0 hover:bg-surface-elevated/50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded bg-surface-elevated overflow-hidden shrink-0 flex items-center justify-center">
                        {product.imageUrl ? (
                          <img src={product.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-[8px] font-bold text-text-muted">{product.code}</span>
                        )}
                      </div>
                      {product.code}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-1.5">
                      {product.name}
                      {product.featured && <span className="text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded font-medium shrink-0">Featured</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-xs">{product.category.name}</td>
                  <td className="px-4 py-3 text-text-secondary">{product.size}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatPrice(product.price)}</td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      value={product.stock}
                      onChange={(e) => handleStockChange(product, e.target.value)}
                      className="w-16 text-center py-1 border border-border rounded text-sm bg-surface"
                      min={0}
                    />
                  </td>
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
              ))}
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
                <Input label="Product Code" id="code" value={form.code} onChange={(e) => updateField('code', e.target.value)} placeholder="e.g. CU50" required />
                <Input label="Product Name" id="name" value={form.name} onChange={(e) => updateField('name', e.target.value)} placeholder="e.g. GHK-Cu" required />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="Size" id="size" value={form.size} onChange={(e) => updateField('size', e.target.value)} placeholder="e.g. 50mg" />
                <Input label="URL Slug" id="slug" value={form.slug} onChange={(e) => updateField('slug', e.target.value)} placeholder="Auto-generated" required />
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <Select
                  label="Category"
                  id="categoryId"
                  value={form.categoryId}
                  onChange={(e) => updateField('categoryId', e.target.value)}
                  options={categories.map(c => ({ value: c.id, label: c.name }))}
                  required
                />
                <Input label="Price (RM)" id="price" type="number" step="0.01" min="0" value={form.price} onChange={(e) => updateField('price', e.target.value)} placeholder="e.g. 100.00" required />
                <Input label="Stock" id="stock" type="number" min="0" value={form.stock} onChange={(e) => updateField('stock', e.target.value)} />
              </div>

              {/* Sale pricing — all three optional; a sale is only active when
                  salePrice + both dates are set and "now" falls within the
                  window (see isSaleActive in lib/utils.ts). Leave blank for
                  no sale. */}
              <div className="grid sm:grid-cols-3 gap-4">
                <Input
                  label="Sale Price (RM, optional)"
                  id="salePrice"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.salePrice}
                  onChange={(e) => updateField('salePrice', e.target.value)}
                  placeholder="Leave blank for no sale"
                />
                <Input
                  label="Sale Starts"
                  id="saleStartsAt"
                  type="datetime-local"
                  value={form.saleStartsAt}
                  onChange={(e) => updateField('saleStartsAt', e.target.value)}
                />
                <Input
                  label="Sale Ends"
                  id="saleEndsAt"
                  type="datetime-local"
                  value={form.saleEndsAt}
                  onChange={(e) => updateField('saleEndsAt', e.target.value)}
                />
              </div>

              {/* Image Upload */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Product Image</label>
                <div className="flex items-start gap-4">
                  <div className="w-28 h-28 rounded-lg border border-border bg-surface-elevated flex items-center justify-center overflow-hidden shrink-0">
                    {form.imageUrl ? (
                      <img src={form.imageUrl} alt="Product" className="w-full h-full object-cover" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-text-muted" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <label className="inline-flex items-center gap-2 px-4 py-2 bg-surface-elevated hover:bg-border rounded-lg text-sm font-medium cursor-pointer transition-colors">
                      <Upload className="w-4 h-4" />
                      Upload Image
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file || !token) return;
                          try {
                            const { url } = await adminUploadImage(token, file);
                            updateField('imageUrl', url);
                          } catch {
                            setFormError('Failed to upload image');
                          }
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <p className="text-xs text-text-muted">JPEG, PNG, or WebP. Max 5MB.</p>
                    {form.imageUrl && (
                      <button
                        type="button"
                        onClick={() => updateField('imageUrl', '')}
                        className="text-xs text-danger hover:underline cursor-pointer"
                      >
                        Remove image
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <CheckboxList
                label="Add-Ons (shown on this product's page)"
                items={products
                  .filter((p) => p.id !== editingId)
                  .map((p) => ({ id: p.id, label: `${p.name}${p.size ? ` — ${p.size}` : ''}` }))}
                selectedIds={form.addOnIds}
                onChange={(addOnIds) => setForm((f) => ({ ...f, addOnIds }))}
                searchPlaceholder="Search products..."
                emptyMessage="No other products available."
              />

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
