'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Plus, Trash2, Upload, ImageIcon, ChevronDown,
  Info, Layers, PackagePlus, FileText, Check, AlertCircle,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { adminGetProducts, adminGetProduct, adminCreateProduct, adminUpdateProduct, adminUploadImage, getCategories } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { CheckboxList } from '@/components/ui/CheckboxList';
import { Animate } from '@/components/ui/Animate';
import type { Product, Category } from '@/types';

interface VariantFormData {
  // Stable React key — independent of the server `id`, which is absent
  // until a new variant is first saved. Lets rows keep their identity (and
  // therefore their mount-in animation doesn't replay) across re-renders.
  key: string;
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

interface UploadState {
  status: 'uploading' | 'success' | 'error';
  progress: number;
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
  addOnOnly: boolean;
  addOnIds: string[];
  // Per-selected-add-on config, keyed by addOnId (a variant id) — required/quantity
  // only meaningful for ids also present in addOnIds.
  addOnConfig: Record<string, { required: boolean; quantity: string }>;
  addOnReminder: string;
  variants: VariantFormData[];
}

const DEFAULT_COA = 'https://verify.janoshik.com/tests/155584-Blind_GLP_C5AGHBRFFNYY';

function newVariant(): VariantFormData {
  return {
    key: crypto.randomUUID(),
    code: '', size: '', price: '', salePrice: '', saleStartsAt: '', saleEndsAt: '', stock: '0', imageUrl: '', active: true,
  };
}

const emptyForm: ProductFormData = {
  name: '', slug: '', categoryId: '',
  description: '', benefits: '', dosageInfo: '', coaUrl: DEFAULT_COA,
  featured: false, active: true, addOnOnly: false,
  addOnIds: [], addOnConfig: {}, addOnReminder: '',
  variants: [newVariant()],
};

function slugify(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function FormSection({
  title,
  description,
  icon: Icon,
  action,
  children,
  delay = 0,
}: {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <Animate variant="fadeUp" delay={delay} duration={0.4}>
      <div className="bg-surface rounded-xl border border-border p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Icon className="w-4.5 h-4.5" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-base">{title}</h2>
              {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
            </div>
          </div>
          {action}
        </div>
        {children}
      </div>
    </Animate>
  );
}

function VariantCard({
  variant,
  onChange,
  onRemove,
  onUploadImage,
  uploadState,
}: {
  variant: VariantFormData;
  onChange: (field: keyof VariantFormData, value: string | boolean) => void;
  onRemove: () => void;
  onUploadImage: (file: File) => void;
  uploadState?: UploadState;
}) {
  const [saleOpen, setSaleOpen] = useState(!!variant.salePrice);
  const isExisting = !!variant.id;
  const uploading = uploadState?.status === 'uploading';

  return (
    <Animate variant="fadeUp" duration={0.3}>
      <div className="rounded-xl border border-border bg-surface-elevated/40 p-4 transition-shadow hover:shadow-sm">
        <div className="flex items-start gap-4">
          <label
            title={uploadState?.status === 'error' ? 'Upload failed — click to retry' : undefined}
            className={`relative w-16 h-16 rounded-lg border overflow-hidden shrink-0 group bg-surface ${
              uploadState?.status === 'error' ? 'border-danger' : 'border-border'
            } ${uploading ? 'cursor-wait' : 'cursor-pointer'}`}
          >
            {variant.imageUrl ? (
              <img src={variant.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-text-muted" />
              </div>
            )}
            <div
              className={`absolute inset-0 flex items-center justify-center transition-colors ${
                uploading
                  ? 'bg-black/60'
                  : uploadState?.status === 'success'
                    ? 'bg-black/50'
                    : uploadState?.status === 'error'
                      ? 'bg-danger/70'
                      : 'bg-black/0 group-hover:bg-black/40'
              }`}
            >
              {uploading ? (
                <span className="text-white text-[11px] font-semibold">{uploadState.progress}%</span>
              ) : uploadState?.status === 'success' ? (
                <Check className="w-5 h-5 text-white" />
              ) : uploadState?.status === 'error' ? (
                <AlertCircle className="w-5 h-5 text-white" />
              ) : (
                <Upload className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>
            {uploading && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
                <div
                  className="h-full bg-white transition-[width] duration-150"
                  style={{ width: `${uploadState.progress}%` }}
                />
              </div>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={uploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) onUploadImage(file);
                e.target.value = '';
              }}
            />
          </label>

          <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Input label="Code" value={variant.code} onChange={(e) => onChange('code', e.target.value)} placeholder="e.g. CU50" required />
            <Input label="Size" value={variant.size} onChange={(e) => onChange('size', e.target.value)} placeholder="e.g. 50mg" />
            <Input label="Price (RM)" type="number" step="0.01" min="0" value={variant.price} onChange={(e) => onChange('price', e.target.value)} required />
            <Input label="Stock" type="number" min="0" value={variant.stock} onChange={(e) => onChange('stock', e.target.value)} />
          </div>

          <button
            type="button"
            onClick={onRemove}
            title={isExisting ? 'Deactivate this size (its order history is kept)' : 'Remove this size'}
            className="p-1.5 hover:bg-red-50 rounded-lg cursor-pointer shrink-0 transition-colors"
          >
            <Trash2 className="w-4 h-4 text-text-muted hover:text-danger" />
          </button>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setSaleOpen((o) => !o)}
            className="text-xs font-medium text-text-secondary hover:text-text-primary flex items-center gap-1 cursor-pointer transition-colors"
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${saleOpen ? 'rotate-180' : ''}`} />
            Sale pricing {variant.salePrice ? '(active)' : '(optional)'}
          </button>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input type="checkbox" checked={variant.active} onChange={(e) => onChange('active', e.target.checked)} className="rounded" />
            Active
          </label>
        </div>

        <div className={`grid transition-all duration-300 ease-out ${saleOpen ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <Input
                label="Sale Price (RM)"
                type="number"
                step="0.01"
                min="0"
                value={variant.salePrice}
                onChange={(e) => onChange('salePrice', e.target.value)}
                placeholder="No sale"
              />
              <Input label="Sale Starts" type="datetime-local" value={variant.saleStartsAt} onChange={(e) => onChange('saleStartsAt', e.target.value)} />
              <Input label="Sale Ends" type="datetime-local" value={variant.saleEndsAt} onChange={(e) => onChange('saleEndsAt', e.target.value)} />
            </div>
          </div>
        </div>
      </div>
    </Animate>
  );
}

export function ProductForm({ productId }: { productId?: string }) {
  const router = useRouter();
  const { token } = useAuth();
  const isEdit = !!productId;

  const [product, setProduct] = useState<Product | null>(null);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState<ProductFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [mounted, setMounted] = useState(false);
  // Keyed by variant.key — tracks each variant image upload independently
  // so uploading one photo doesn't affect another row's indicator.
  const [uploadStatus, setUploadStatus] = useState<Record<string, UploadState>>({});

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { getCategories().then(setCategories).catch(() => {}); }, []);

  useEffect(() => {
    if (!token) return;
    // Used only to populate the add-on picker's list of other products.
    adminGetProducts(token, { limit: '100' }).then((r) => setAllProducts(r.data)).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token || !isEdit || !productId) return;
    adminGetProduct(token, productId)
      .then((found) => {
        setProduct(found);
        let benefits: string[] = [];
        try { if (found.benefits) benefits = JSON.parse(found.benefits); } catch {}
        setForm({
          name: found.name,
          slug: found.slug,
          categoryId: found.categoryId,
          description: found.description || '',
          benefits: benefits.join('\n'),
          dosageInfo: found.dosageInfo || '',
          coaUrl: found.coaUrl || DEFAULT_COA,
          featured: found.featured,
          active: found.active,
          addOnOnly: found.addOnOnly,
          addOnIds: found.addOns?.map((a) => a.id) || [],
          addOnConfig: Object.fromEntries(
            (found.addOns || []).map((a) => [a.id, { required: a.addOnRequired, quantity: String(a.addOnQuantity) }])
          ),
          addOnReminder: found.addOnReminder || '',
          variants: found.variants.map((v) => ({
            key: v.id,
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
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token, productId, isEdit]);

  // Flattens every OTHER product's active variants into add-on picker
  // options — an add-on points at a specific sellable variant (e.g. "Bac
  // Water — 3mL"), not a whole product line.
  const addOnOptions = useMemo(() => {
    return allProducts
      .filter((p) => p.id !== productId)
      .flatMap((p) => p.variants.filter((v) => v.active).map((v) => ({
        id: v.id,
        label: `${p.name}${v.size ? ` — ${v.size}` : ''}`,
      })));
  }, [allProducts, productId]);

  const updateField = (field: keyof ProductFormData, value: string | boolean) => {
    setForm((f) => {
      const updated = { ...f, [field]: value };
      if (field === 'name' && !isEdit) {
        updated.slug = slugify(String(value));
      }
      return updated;
    });
  };

  const updateVariant = (key: string, field: keyof VariantFormData, value: string | boolean) => {
    setForm((f) => ({ ...f, variants: f.variants.map((v) => (v.key === key ? { ...v, [field]: value } : v)) }));
  };

  const addVariantRow = () => setForm((f) => ({ ...f, variants: [...f.variants, newVariant()] }));
  const removeVariantRow = (key: string) => setForm((f) => ({ ...f, variants: f.variants.filter((v) => v.key !== key) }));

  const uploadVariantImage = async (key: string, file: File) => {
    if (!token) return;
    setUploadStatus((s) => ({ ...s, [key]: { status: 'uploading', progress: 0 } }));
    try {
      const { url } = await adminUploadImage(token, file, (progress) => {
        setUploadStatus((s) => ({ ...s, [key]: { status: 'uploading', progress } }));
      });
      updateVariant(key, 'imageUrl', url);
      setUploadStatus((s) => ({ ...s, [key]: { status: 'success', progress: 100 } }));
      setTimeout(() => {
        setUploadStatus((s) => {
          const { [key]: _removed, ...rest } = s;
          return rest;
        });
      }, 1500);
    } catch {
      setUploadStatus((s) => ({ ...s, [key]: { status: 'error', progress: 0 } }));
    }
  };

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
      addOnOnly: form.addOnOnly,
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
      if (isEdit && productId) {
        await adminUpdateProduct(token, productId, payload);
      } else {
        await adminCreateProduct(token, payload);
      }
      router.push('/admin/products');
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setFormError(message || 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  if (notFound) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <p className="text-text-muted mb-4">This product couldn&apos;t be found.</p>
        <Button variant="outline" onClick={() => router.push('/admin/products')}><ArrowLeft className="w-4 h-4" /> Back to Products</Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-28">
      <Animate variant="fadeDown" duration={0.4}>
        <div className="flex items-center gap-3 mb-6">
          <button
            type="button"
            onClick={() => router.push('/admin/products')}
            className="p-2 hover:bg-surface-elevated rounded-lg cursor-pointer transition-colors shrink-0"
            aria-label="Back to Products"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-display text-2xl font-bold">{isEdit ? (product ? `Edit ${product.name}` : 'Edit Product') : 'Add New Product'}</h1>
            <p className="text-sm text-text-muted">{isEdit ? 'Update details, sizes, and add-ons' : 'Create a new product line with its sizes'}</p>
          </div>
        </div>
      </Animate>

      {loading ? (
        <div className="space-y-4 animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 bg-surface-elevated rounded-xl" />)}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          <FormSection title="Basic Info" icon={Info} delay={0}>
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="Product Name" value={form.name} onChange={(e) => updateField('name', e.target.value)} placeholder="e.g. GHK-Cu" required />
                <Input label="URL Slug" value={form.slug} onChange={(e) => updateField('slug', e.target.value)} placeholder="Auto-generated" required />
              </div>
              <Select
                label="Category"
                value={form.categoryId}
                onChange={(e) => updateField('categoryId', e.target.value)}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                required
              />
              <div className="flex items-center gap-6 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.featured} onChange={(e) => updateField('featured', e.target.checked)} className="rounded accent-yellow-500" />
                  <span className="text-sm font-medium text-text-secondary">Featured</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.active} onChange={(e) => updateField('active', e.target.checked)} className="rounded" />
                  <span className="text-sm font-medium text-text-secondary">Active (visible on store)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer" title="Hides this from the catalog and its own product page, but keeps it usable as another product's required/optional add-on">
                  <input type="checkbox" checked={form.addOnOnly} onChange={(e) => updateField('addOnOnly', e.target.checked)} className="rounded" />
                  <span className="text-sm font-medium text-text-secondary">Add-on only (hide from storefront)</span>
                </label>
              </div>
            </div>
          </FormSection>

          <FormSection
            title="Variants (Sizes)"
            description="Each size is its own SKU with its own price, stock, and photo"
            icon={Layers}
            delay={0.05}
            action={<Button type="button" variant="outline" size="sm" onClick={addVariantRow}><Plus className="w-3.5 h-3.5" /> Add Variant</Button>}
          >
            <div className="space-y-3">
              {form.variants.map((v) => (
                <VariantCard
                  key={v.key}
                  variant={v}
                  onChange={(field, value) => updateVariant(v.key, field, value)}
                  onRemove={() => removeVariantRow(v.key)}
                  onUploadImage={(file) => uploadVariantImage(v.key, file)}
                  uploadState={uploadStatus[v.key]}
                />
              ))}
            </div>
          </FormSection>

          <FormSection
            title="Add-Ons"
            description="Offered on this product's page — force-select a required one to lock it in the cart"
            icon={PackagePlus}
            delay={0.1}
          >
            <div className="space-y-4">
              <CheckboxList
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
                label="Add-on reminder (optional, plain text nudge shown near Add to Cart)"
                value={form.addOnReminder}
                onChange={(e) => updateField('addOnReminder', e.target.value)}
                placeholder="e.g. Remember: this peptide needs Bacteriostatic Water to reconstitute"
              />
            </div>
          </FormSection>

          <FormSection title="Content" icon={FileText} delay={0.15}>
            <div className="space-y-4">
              <Input
                label="Certificate of Analysis URL"
                value={form.coaUrl}
                onChange={(e) => updateField('coaUrl', e.target.value)}
                placeholder="https://verify.janoshik.com/tests/..."
              />
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateField('description', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="Product description..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Benefits (one per line)</label>
                <textarea
                  value={form.benefits}
                  onChange={(e) => updateField('benefits', e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder={"Stimulates collagen production\nReduces fine lines\nPromotes wound healing"}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Dosage Info</label>
                <textarea
                  value={form.dosageInfo}
                  onChange={(e) => updateField('dosageInfo', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="Dosage instructions..."
                />
              </div>
            </div>
          </FormSection>

          {formError && (
            <Animate variant="fade" duration={0.2}>
              <p className="text-sm text-danger">{formError}</p>
            </Animate>
          )}
        </form>
      )}

      {/* Rendered via portal to document.body: the admin layout's <main> has
          overflow-auto, which becomes the actual scrolling element and traps
          a `fixed` descendant inside its own box instead of the real
          viewport — the bar would scroll away with the page and end up
          below the footer instead of staying pinned on-screen. */}
      {mounted && !loading &&
        createPortal(
          <div className="fixed bottom-0 inset-x-0 lg:left-64 bg-surface/95 backdrop-blur-sm border-t border-border p-4 flex justify-end gap-3 z-30">
            <Button type="button" variant="outline" onClick={() => router.push('/admin/products')}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Update Product' : 'Create Product'}
            </Button>
          </div>,
          document.body
        )}
    </div>
  );
}
