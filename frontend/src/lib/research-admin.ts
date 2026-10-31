// The research editor's live "Contract check": the same limits the API runs before it
// publishes (backend/src/modules/research/research.rules.ts), so the two never disagree.
import { IMAGE_TOKEN } from '@/lib/research-markdown';
import type { ResearchDraft } from '@/types';

export type Errors = Record<string, string>;

export const LIMITS = {
  h1: [10, 90],
  dek: [40, 260],
  'seo.title': [20, 65],
  'seo.description': [70, 160],
  alt: [10, 160],
} as const;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function checkSlug(s: string): string | null {
  if (!s) return 'Required.';
  if (s.length < 2) return 'At least 2 characters.';
  if (s.length > 90) return 'At most 90 characters.';
  return SLUG.test(s) ? null : 'Lowercase letters, digits and single hyphens.';
}

export function contractCheck(d: ResearchDraft): Errors {
  const out: Errors = {};
  const len = (path: keyof typeof LIMITS, v: string) => {
    const [min, max] = LIMITS[path];
    const n = v.trim().length;
    if (n < min) out[path] = n === 0 ? 'Required.' : `At least ${min} characters.`;
    else if (n > max) out[path] = `At most ${max} characters.`;
  };
  const slug = checkSlug(d.slug);
  if (slug) out.slug = slug;
  len('h1', d.title);
  len('dek', d.dek);
  if (d.body.trim().length < 200) out.body = d.body.trim() ? 'The article body is too short to publish.' : 'Required.';
  if (!d.leadImageUrl) out.leadImage = 'Required.';
  else {
    const n = d.leadImageAlt.trim().length;
    if (n < LIMITS.alt[0] || n > LIMITS.alt[1]) out['leadImage.alt'] = 'Alt text is required (10–160 characters).';
  }
  if (d.citations.length < 2) out.citations = 'Research summaries cite at least two studies.';
  d.citations.forEach((c, i) => {
    if (c.finding.trim().length < 20) out[`citations.${i}.finding`] = 'Say what the study found (at least 20 characters).';
  });
  const images = new Map(d.images.map((im) => [im.id, im]));
  for (const m of d.body.matchAll(IMAGE_TOKEN)) {
    const im = images.get(m[1]);
    if (!im) out.body = `The text places a photo that no longer exists ({{image:${m[1]}}}).`;
    else if (!im.alt.trim()) out[`images.${im.id}.alt`] = 'Every placed photo needs alt text.';
  }
  len('seo.title', d.seoTitle);
  len('seo.description', d.seoDescription);
  return out;
}

/** The first error at `path` or anywhere under it. */
export function errAt(e: Errors, path: string): string | null {
  if (e[path]) return e[path];
  const k = Object.keys(e).find((x) => x.startsWith(`${path}.`));
  return k ? e[k] : null;
}

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** "25 Oct 2026", or a dash. */
export const date = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' }) : '—';

/** "3 min ago", "yesterday", "12 Oct". */
export function ago(v: string) {
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  return new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kuala_Lumpur' });
}

/** Scroll to a field and flash it (Teliti's jumpToField). */
export function jumpToField(field: string) {
  const key = field.split('.').slice(0, 2).join('.');
  const el =
    document.querySelector<HTMLElement>(`[data-field="${key}"]`) ??
    document.querySelector<HTMLElement>(`[data-field="${field.split('.')[0]}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  el.querySelector<HTMLElement>('input, textarea, select')?.focus({ preventScroll: true });
}
