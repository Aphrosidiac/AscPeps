'use client';

import { useEffect, useState, useRef } from 'react';
import { Plus, Pencil, X, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetProducts, adminCreateProduct, adminUpdateProduct, adminDeleteProduct, getCategories } from '@/lib/api';
import { formatPrice } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import type { Product, Category } from '@/types';

interface ProductFormData {
  code: string;
  name: string;
  slug: string;
  categoryId: string;
  size: string;
  price: string;
  description: string;
  benefits: string;
  dosageInfo: string;
  stock: string;
  active: boolean;
}

const emptyForm: ProductFormData = {
  code: '', name: '', slug: '', categoryId: '', size: '',
  price: '', description: '', benefits: '', dosageInfo: '',
  stock: '0', active: true,
};

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export default function AdminProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const stockTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = () => {
    if (!token) return;
    const params: Record<string, string> = { limit: '100' };
    if (search) params.search = search;
    adminGetProducts(token, params)
      .then((r) => setProducts(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [token, search]);
  useEffect(() => { getCategories().then(setCategories).catch(() => {}); }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (product: Product) => {
    setEditingId(product.id);
    const benefits: string[] = product.benefits ? JSON.parse(product.benefits) : [];
    setForm({
      code: product.code,
      name: product.name,
      slug: product.slug,
      categoryId: product.categoryId,
      size: product.size || '',
      price: String(product.price / 100),
      description: product.description || '',
      benefits: benefits.join('\n'),
      dosageInfo: product.dosageInfo || '',
      stock: String(product.stock),
      active: product.active,
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

    const benefitsArray = form.benefits.split('\n').map(b => b.trim()).filter(Boolean);

    const payload = {
      code: form.code,
      name: form.name,
      slug: form.slug || slugify(`${form.name}-${form.size}`),
      categoryId: form.categoryId,
      size: form.size || undefined,
      price: priceInSen,
      description: form.description || undefined,
      benefits: benefitsArray.length > 0 ? JSON.stringify(benefitsArray) : undefined,
      dosageInfo: form.dosageInfo || undefined,
      stock: parseInt(form.stock) || 0,
      active: form.active,
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
        <Button onClick={openCreate}><Plus className="w-4 h-4" /> Add Product</Button>
      </div>

      <div className="relative max-w-sm mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          placeholder="Search by name or code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
        />
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 bg-surface-elevated rounded" />)}
        </div>
      ) : products.length === 0 ? (
        <p className="text-text-muted py-8 text-center">No products found.</p>
      ) : (
        <div className="bg-surface rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-elevated">
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Code</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Name</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Category</th>
                <th className="text-left px-4 py-3 font-medium text-text-secondary">Size</th>
                <th className="text-right px-4 py-3 font-medium text-text-secondary">Price</th>
                <th className="text-center px-4 py-3 font-medium text-text-secondary">Stock</th>
                <th className="text-center px-4 py-3 font-medium text-text-secondary">Status</th>
                <th className="text-center px-4 py-3 font-medium text-text-secondary">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-border last:border-0 hover:bg-surface-elevated/50">
                  <td className="px-4 py-3 font-mono text-xs">{product.code}</td>
                  <td className="px-4 py-3 font-medium">{product.name}</td>
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

              <div className="flex items-center gap-2">
                <input type="checkbox" id="active" checked={form.active} onChange={(e) => updateField('active', e.target.checked)} className="rounded" />
                <label htmlFor="active" className="text-sm font-medium text-text-secondary">Active (visible on store)</label>
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
    </div>
  );
}
