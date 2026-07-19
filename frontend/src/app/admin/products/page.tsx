'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Pencil, Search, Trash2, ArrowUp, ArrowDown, ArrowUpDown, RotateCcw, ChevronDown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetProducts, adminUpdateProduct, adminDeleteProduct, getCategories } from '@/lib/api';
import { formatPrice, getDefaultVariant } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { FeaturedOrderModal } from './FeaturedOrderModal';
import type { Product, Category } from '@/types';

type SortKey = 'name' | 'category' | 'price' | 'stock' | 'status';
type StatusFilter = 'all' | 'active' | 'inactive';
type FeaturedFilter = 'all' | 'featured' | 'not-featured';
type StockFilter = 'all' | 'in-stock' | 'out-of-stock';

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
  const [showFeaturedOrder, setShowFeaturedOrder] = useState(false);

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl font-bold">Products</h1>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => setShowFeaturedOrder(true)}><ArrowUpDown className="w-4 h-4" /> Manage Featured Order</Button>
          <Link href="/admin/products/new"><Button><Plus className="w-4 h-4" /> Add Product</Button></Link>
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
                          {product.addOnOnly && <span className="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-medium shrink-0">Add-on only</span>}
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
                        <Link href={`/admin/products/${product.id}`} className="p-1.5 hover:bg-surface-elevated rounded cursor-pointer inline-flex" title="Edit">
                          <Pencil className="w-4 h-4 text-text-muted" />
                        </Link>
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
