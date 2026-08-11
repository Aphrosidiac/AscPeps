'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Upload, ImageIcon, Info, FileText, Quote, PackagePlus, Images, ChevronUp, ChevronDown, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  adminGetInsights, adminGetInsight, adminCreateInsight, adminUpdateInsight,
  adminUploadImage, adminGetProducts,
} from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { CheckboxList } from '@/components/ui/CheckboxList';
import { Animate } from '@/components/ui/Animate';
import type { Insight, InsightFigureInput, Product } from '@/types';

interface InsightFormData {
  title: string;
  slug: string;
  category: string;
  excerpt: string;
  content: string;
  coverImageUrl: string;
  authorName: string;
  authorRole: string;
  citationTitle: string;
  citationSource: string;
  citationUrl: string;
  relatedProductIds: string[];
  figures: InsightFigureInput[];
  published: boolean;
}

const emptyForm: InsightFormData = {
  title: '', slug: '', category: '', excerpt: '', content: '', coverImageUrl: '',
  authorName: 'Asywa', authorRole: 'Founder & CEO, Ascend MY',
  citationTitle: '', citationSource: '', citationUrl: '',
  relatedProductIds: [], figures: [], published: false,
};

// Capped at 80 chars on a word boundary. Article titles here run long, and an
// untruncated slug produced 116-char URLs that are bad for SEO and used to
// overflow Fastify's route-param limit outright. Trimming to the last hyphen
// keeps the slug readable rather than cutting mid-word.
function slugify(text: string) {
  const full = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  if (full.length <= 80) return full;
  const cut = full.slice(0, 80);
  const lastHyphen = cut.lastIndexOf('-');
  return (lastHyphen > 40 ? cut.slice(0, lastHyphen) : cut).replace(/-$/, '');
}

function FormSection({
  title, description, icon: Icon, children, delay = 0,
}: {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <Animate variant="fadeUp" delay={delay} duration={0.4}>
      <div className="bg-surface rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon className="w-4.5 h-4.5" />
          </div>
          <div>
            <h2 className="font-display font-semibold text-base">{title}</h2>
            {description && <p className="text-xs text-text-muted mt-0.5">{description}</p>}
          </div>
        </div>
        {children}
      </div>
    </Animate>
  );
}

export function InsightForm({ insightId }: { insightId?: string }) {
  const router = useRouter();
  const { token } = useAuth();
  const isEdit = !!insightId;

  const [insight, setInsight] = useState<Insight | null>(null);
  const [allInsights, setAllInsights] = useState<Insight[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState<InsightFormData>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!token) return;
    // Used only to populate the category suggestions datalist below.
    adminGetInsights(token, { limit: '100' }).then((r) => setAllInsights(r.data)).catch(() => {});
    // Used only to populate the "mentioned products" picker.
    adminGetProducts(token, { limit: '100' }).then((r) => setAllProducts(r.data)).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token || !isEdit || !insightId) return;
    adminGetInsight(token, insightId)
      .then((found) => {
        setInsight(found);
        setForm({
          title: found.title,
          slug: found.slug,
          category: found.category,
          excerpt: found.excerpt,
          content: found.content,
          coverImageUrl: found.coverImageUrl || '',
          authorName: found.authorName,
          authorRole: found.authorRole,
          citationTitle: found.citationTitle || '',
          citationSource: found.citationSource || '',
          citationUrl: found.citationUrl || '',
          relatedProductIds: found.relatedProductIds,
          figures: (found.figures ?? []).map((f) => ({
            imageUrl: f.imageUrl, caption: f.caption, altText: f.altText,
            credit: f.credit, creditUrl: f.creditUrl,
          })),
          published: found.published,
        });
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [token, insightId, isEdit]);

  const categoryOptions = useMemo(
    () => Array.from(new Set(allInsights.map((i) => i.category))),
    [allInsights]
  );

  const productOptions = useMemo(
    () => allProducts.filter((p) => p.active && !p.addOnOnly).map((p) => ({ id: p.id, label: p.name })),
    [allProducts]
  );

  const updateField = <K extends keyof InsightFormData>(field: K, value: InsightFormData[K]) => {
    setForm((f) => {
      const updated = { ...f, [field]: value };
      if (field === 'title' && !isEdit) {
        updated.slug = slugify(String(value));
      }
      return updated;
    });
  };

  const uploadCoverImage = async (file: File) => {
    if (!token) return;
    try {
      const { url } = await adminUploadImage(token, file);
      updateField('coverImageUrl', url);
    } catch {
      setFormError('Failed to upload image');
    }
  };

  /* ----- figures. Array position is the printed figure number, so adding,
     removing and reordering all just move array entries — nothing stores or
     recalculates a separate number. */
  const addFigure = async (file: File) => {
    if (!token) return;
    setFormError('');
    try {
      const { url } = await adminUploadImage(token, file);
      setForm((f) => ({
        ...f,
        figures: [...f.figures, { imageUrl: url, caption: '', altText: '', credit: null, creditUrl: null }],
      }));
    } catch {
      setFormError('Failed to upload figure');
    }
  };

  const updateFigure = (index: number, patch: Partial<InsightFigureInput>) => {
    setForm((f) => ({
      ...f,
      figures: f.figures.map((figure, i) => (i === index ? { ...figure, ...patch } : figure)),
    }));
  };

  const removeFigure = (index: number) => {
    setForm((f) => ({ ...f, figures: f.figures.filter((_, i) => i !== index) }));
  };

  const moveFigure = (index: number, direction: -1 | 1) => {
    setForm((f) => {
      const target = index + direction;
      if (target < 0 || target >= f.figures.length) return f;
      const next = [...f.figures];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...f, figures: next };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setFormError('');

    if (!form.title.trim() || !form.category.trim() || !form.excerpt.trim() || !form.content.trim()) {
      setFormError('Title, category, excerpt, and content are required');
      setSaving(false);
      return;
    }

    // Alt text is enforced here rather than in the DB: a diagram with no alt
    // text is silently invisible to a screen reader, and the moment to write it
    // is while you're looking at the figure.
    const incomplete = form.figures.findIndex((f) => !f.caption.trim() || !f.altText.trim());
    if (incomplete !== -1) {
      setFormError(`Figure ${incomplete + 1} needs both a caption and alt text`);
      setSaving(false);
      return;
    }

    const payload = {
      title: form.title.trim(),
      slug: form.slug || slugify(form.title),
      category: form.category.trim(),
      excerpt: form.excerpt.trim(),
      content: form.content.trim(),
      coverImageUrl: form.coverImageUrl || null,
      authorName: form.authorName.trim() || undefined,
      authorRole: form.authorRole.trim() || undefined,
      citationTitle: form.citationTitle.trim() || null,
      citationSource: form.citationSource.trim() || null,
      citationUrl: form.citationUrl.trim() || null,
      relatedProductIds: form.relatedProductIds,
      // Sent as the complete ordered list; the server derives each figure's
      // printed number from its position here.
      figures: form.figures.map((f) => ({
        imageUrl: f.imageUrl,
        caption: f.caption.trim(),
        altText: f.altText.trim(),
        credit: f.credit?.trim() || null,
        creditUrl: f.creditUrl?.trim() || null,
      })),
      published: form.published,
    };

    try {
      if (isEdit && insightId) {
        await adminUpdateInsight(token, insightId, payload);
      } else {
        await adminCreateInsight(token, payload);
      }
      router.push('/admin/insights');
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setFormError(message || 'Failed to save insight');
    } finally {
      setSaving(false);
    }
  };

  if (notFound) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <p className="text-text-muted mb-4">This insight couldn&apos;t be found.</p>
        <Button variant="outline" onClick={() => router.push('/admin/insights')}><ArrowLeft className="w-4 h-4" /> Back to Insights</Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto pb-28">
      <Animate variant="fadeDown" duration={0.4}>
        <div className="flex items-center gap-3 mb-6">
          <button
            type="button"
            onClick={() => router.push('/admin/insights')}
            className="p-2 hover:bg-surface-elevated rounded-lg cursor-pointer transition-colors shrink-0"
            aria-label="Back to Insights"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="font-display text-2xl font-bold">{isEdit ? (insight ? `Edit "${insight.title}"` : 'Edit Insight') : 'New Insight'}</h1>
            <p className="text-sm text-text-muted">{isEdit ? 'Update this article' : 'Write a new research or product-update article'}</p>
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
              <div className="flex items-start gap-4">
                <label className="relative w-24 h-24 rounded-lg border border-border bg-surface-elevated overflow-hidden shrink-0 group cursor-pointer">
                  {form.coverImageUrl ? (
                    <img src={form.coverImageUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-5 h-5 text-text-muted" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-colors">
                    <Upload className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) await uploadCoverImage(file);
                      e.target.value = '';
                    }}
                  />
                </label>
                <div className="flex-1 grid sm:grid-cols-2 gap-4">
                  <Input label="Title" value={form.title} onChange={(e) => updateField('title', e.target.value)} placeholder="e.g. What the phase 2 retatrutide trial measured" required />
                  <Input label="URL Slug" value={form.slug} onChange={(e) => updateField('slug', e.target.value)} placeholder="Auto-generated" required />
                </div>
              </div>
              <div>
                <Input
                  label="Category"
                  value={form.category}
                  onChange={(e) => updateField('category', e.target.value)}
                  placeholder="e.g. Clinical Trials"
                  list="insight-categories"
                  required
                />
                <datalist id="insight-categories">
                  {categoryOptions.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="Author name" value={form.authorName} onChange={(e) => updateField('authorName', e.target.value)} />
                <Input label="Author role" value={form.authorRole} onChange={(e) => updateField('authorRole', e.target.value)} />
              </div>
              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input type="checkbox" checked={form.published} onChange={(e) => updateField('published', e.target.checked)} className="rounded" />
                <span className="text-sm font-medium text-text-secondary">Published (visible on the storefront)</span>
              </label>
            </div>
          </FormSection>

          <FormSection title="Content" icon={FileText} delay={0.05}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Excerpt</label>
                <textarea
                  value={form.excerpt}
                  onChange={(e) => updateField('excerpt', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="One or two sentences shown on the Insights list and used as the article's lead paragraph."
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Body</label>
                <textarea
                  value={form.content}
                  onChange={(e) => updateField('content', e.target.value)}
                  rows={12}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder={'Write the article. Leave a blank line between paragraphs.'}
                  required
                />
                <p className="text-xs text-text-muted mt-1">Read time is estimated automatically from the word count.</p>
              </div>
            </div>
          </FormSection>

          <FormSection title="Referenced Study" description="Optional — shown as a citation box on the article" icon={Quote} delay={0.1}>
            <div className="space-y-4">
              <Input label="Paper title" value={form.citationTitle} onChange={(e) => updateField('citationTitle', e.target.value)} placeholder="e.g. Triple-Hormone-Receptor Agonist Retatrutide for Obesity" />
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="Source" value={form.citationSource} onChange={(e) => updateField('citationSource', e.target.value)} placeholder="e.g. New England Journal of Medicine, 2023" />
                <Input label="Link to paper" value={form.citationUrl} onChange={(e) => updateField('citationUrl', e.target.value)} placeholder="https://..." />
              </div>
            </div>
          </FormSection>

          <FormSection
            title="Figures"
            description="Numbered diagrams shown below the article — refer to them in the body as “Figure 1”, “Figure 2”"
            icon={Images}
            delay={0.125}
          >
            {form.figures.length === 0 ? (
              <p className="text-sm text-text-muted mb-4">No figures yet.</p>
            ) : (
              <div className="space-y-4 mb-4">
                {form.figures.map((figure, index) => (
                  <div key={index} className="border border-border rounded-xl p-4">
                    <div className="flex gap-4">
                      {/* White panel + object-contain, matching how the reader
                          sees it — a diagram cropped to fill would mislead the
                          author about what actually publishes. */}
                      <div className="w-28 h-28 shrink-0 rounded-lg bg-white border border-border overflow-hidden flex items-center justify-center">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={figure.imageUrl} alt="" className="max-w-full max-h-full object-contain" />
                      </div>

                      <div className="flex-1 min-w-0 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold">Figure {index + 1}</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => moveFigure(index, -1)}
                              disabled={index === 0}
                              aria-label={`Move figure ${index + 1} up`}
                              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <ChevronUp className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveFigure(index, 1)}
                              disabled={index === form.figures.length - 1}
                              aria-label={`Move figure ${index + 1} down`}
                              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-elevated transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                            >
                              <ChevronDown className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeFigure(index)}
                              aria-label={`Remove figure ${index + 1}`}
                              className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <Input
                          label="Caption"
                          value={figure.caption}
                          onChange={(e) => updateFigure(index, { caption: e.target.value })}
                          placeholder="e.g. Retatrutide's mechanisms of action."
                        />
                        <Input
                          label="Alt text"
                          value={figure.altText}
                          onChange={(e) => updateFigure(index, { altText: e.target.value })}
                          placeholder="What the diagram actually shows, for screen readers"
                        />
                        <div className="grid sm:grid-cols-2 gap-3">
                          <Input
                            label="Credit"
                            value={figure.credit ?? ''}
                            onChange={(e) => updateFigure(index, { credit: e.target.value })}
                            placeholder="Adapted from Doe et al., 2025 (CC BY 4.0)"
                          />
                          <Input
                            label="Credit link"
                            value={figure.creditUrl ?? ''}
                            onChange={(e) => updateFigure(index, { creditUrl: e.target.value })}
                            placeholder="https://..."
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm font-medium text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors cursor-pointer">
              <Upload className="w-4 h-4" />
              Add figure
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  // Reset first: picking the same file twice in a row fires no
                  // change event otherwise.
                  e.target.value = '';
                  if (file) await addFigure(file);
                }}
              />
            </label>

            <p className="text-xs text-text-muted mt-3">
              Figures from published papers are usually copyrighted. Credit the source, and prefer
              redrawing a diagram over screenshotting one.
            </p>
          </FormSection>

          <FormSection title="Mentioned Products" description="Shown as linked chips at the end of the article" icon={PackagePlus} delay={0.15}>
            <CheckboxList
              items={productOptions}
              selectedIds={form.relatedProductIds}
              onChange={(relatedProductIds) => setForm((f) => ({ ...f, relatedProductIds }))}
              searchPlaceholder="Search products..."
              emptyMessage="No products available."
            />
          </FormSection>

          {formError && (
            <Animate variant="fade" duration={0.2}>
              <p className="text-sm text-danger">{formError}</p>
            </Animate>
          )}
        </form>
      )}

      {/* Portal to document.body — the admin layout's <main> has overflow-auto,
          which would otherwise trap this fixed bar inside its own box instead
          of the real viewport (see ProductForm.tsx for the same fix). */}
      {mounted && !loading &&
        createPortal(
          <div className="fixed bottom-0 inset-x-0 lg:left-64 bg-surface/95 backdrop-blur-sm border-t border-border p-4 flex justify-end gap-3 z-30">
            <Button type="button" variant="outline" onClick={() => router.push('/admin/insights')}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Update Insight' : 'Create Insight'}
            </Button>
          </div>,
          document.body
        )}
    </div>
  );
}
