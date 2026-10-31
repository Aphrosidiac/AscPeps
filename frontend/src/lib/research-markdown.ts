// Research article bodies: markdown in, HTML out. One renderer for the
// storefront page (server-rendered, so crawlers and the LCP see the final
// text) and the admin's live preview, so the preview is the page.
//
// Escape first, then add markup for an allowlist: ##/### headings, paragraphs,
// lists, quotes, tables, rules, emphasis, code and links (http(s), site paths,
// #anchors). No raw HTML survives.
//
// Photos are placed with `{{image:<id>}}` anywhere in the text, mid-sentence
// included. Each renders as a block-level <span role="figure">: valid inside a
// <p>, so the sentence stays one paragraph around it and nothing is re-parented
// by the browser (no hydration mismatch, no split paragraphs). An unknown id
// renders nothing.

import { getImageProps } from 'next/image';

export interface BodyImage {
  id: string;
  url: string;
  width: number;
  height: number;
  alt: string;
  caption?: string | null;
  credit?: string | null;
  creditUrl?: string | null;
}

export const IMAGE_TOKEN = /\{\{image:([a-z0-9]+)\}\}/g;
/** A product card on a line of its own: `{{product:<id>}}`, rendered from the catalogue, never typed (Teliti R-03). */
export const PRODUCT_TOKEN = /^\{\{product:([A-Za-z0-9_-]+)\}\}$/;

export interface EmbedProduct {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  /** "10 mg · 30 mg" */
  sizes: string;
  /** "RM 150–375" */
  price: string;
}

/** A heading's anchor: lowercase words joined by hyphens (Teliti's rule, so the same headings get the same ids). */
export const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>|[*_`]/g, '')
    .replace(/&[a-z]+;|[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');

/** The h2s of a body, for the "On this page" list (same ids as the rendered headings). */
export function headings(src: string): { id: string; text: string }[] {
  return [...src.matchAll(/^## +(.+)$/gm)].map((m) => ({
    id: slugify(m[1]),
    text: m[1].replace(IMAGE_TOKEN, '').replace(/[*_`]/g, '').trim(),
  }));
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Where the column is at most 680 px wide (Teliti's reading column); full width on phones. */
const IMAGE_SIZES = '(min-width: 760px) 680px, 100vw';

function imageHtml(im: BodyImage, eager: boolean): string {
  const { props } = getImageProps({ src: im.url, width: im.width, height: im.height, alt: im.alt, sizes: IMAGE_SIZES });
  const attrs = [
    `src="${esc(String(props.src))}"`,
    props.srcSet ? `srcset="${esc(props.srcSet)}"` : '',
    props.sizes ? `sizes="${esc(props.sizes)}"` : '',
    `width="${im.width}"`,
    `height="${im.height}"`,
    `alt="${esc(im.alt)}"`,
    eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"',
    'decoding="async"',
  ]
    .filter(Boolean)
    .join(' ');
  const credit = im.credit
    ? ` <span class="rs-img__credit">${
        im.creditUrl && /^https?:\/\//.test(im.creditUrl)
          ? `<a href="${esc(im.creditUrl)}" rel="noopener">${esc(im.credit)}</a>`
          : esc(im.credit)
      }</span>`
    : '';
  const capId = `cap-${im.id}`;
  const cap = im.caption || im.credit ? `<span class="rs-img__cap" id="${capId}">${im.caption ? esc(im.caption) : ''}${credit}</span>` : '';
  return `<span class="rs-img" data-image="${im.id}"${cap ? ` role="figure" aria-labelledby="${capId}"` : ''}><img ${attrs}>${cap}</span>`;
}

function safeHref(href: string): string | null {
  const h = href.replace(/&amp;/g, '&');
  if (/^https?:\/\//i.test(h) || /^\/(?!\/)/.test(h) || /^#[\w-]+$/.test(h) || /^mailto:/i.test(h)) return h;
  return null;
}

export interface RenderOptions {
  images?: BodyImage[];
  products?: EmbedProduct[];
  /** The admin preview: say so when a token points at nothing, instead of dropping it. */
  showMissing?: boolean;
  /** Give the first placed photo eager loading (when it is above the fold). */
  eagerFirstImage?: boolean;
}

export function renderResearchBody(src: string, opts: RenderOptions = {}): string {
  const byId = new Map((opts.images ?? []).map((im) => [im.id, im]));
  const products = new Map((opts.products ?? []).map((p) => [p.id, p]));
  const card = (id: string) => {
    const p = products.get(id);
    if (!p) return opts.showMissing ? `<div class="rs-prose__card rs-prose__card--missing">Unknown product <code>${esc(id)}</code>: remove the card or pick another.</div>` : '';
    const img = p.imageUrl
      ? (() => {
          const { props } = getImageProps({ src: p.imageUrl, width: 88, height: 110, alt: '', sizes: '88px' });
          return `<img src="${esc(String(props.src))}"${props.srcSet ? ` srcset="${esc(props.srcSet)}"` : ''} width="88" height="110" alt="" loading="lazy" decoding="async">`;
        })()
      : '<span class="rs-prose__card-ph"></span>';
    return `<div class="rs-prose__card"><a class="rs-prose__card-link" href="/products/${esc(p.slug)}">${img}<span class="rs-prose__card-meta"><span class="rs-prose__card-name">${esc(p.name)}</span><span class="rs-prose__card-sub">${esc([p.sizes, p.price].filter(Boolean).join(' · '))}</span></span></a></div>`;
  };
  let placed = 0;

  const inline = (raw: string): string => {
    // Tokens out first, so emphasis/links can't reach inside them.
    const slots: string[] = [];
    const keep = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;
    let s = raw.replace(IMAGE_TOKEN, (_, id: string) => {
      const im = byId.get(id);
      if (!im) return opts.showMissing ? keep(`<span class="rs-img rs-img--missing">Photo <code>${esc(id)}</code> no longer exists: remove this token.</span>`) : '';
      return keep(imageHtml(im, !!opts.eagerFirstImage && placed++ === 0));
    });
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text: string, href: string) => {
      const h = safeHref(href);
      if (!h) return text;
      const external = /^https?:\/\//i.test(h);
      return keep(`<a href="${esc(h)}"${external ? ' rel="noopener"' : ''}>${text}</a>`);
    });
    s = s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    // Slots may hold slots (a link around code): resolve until none are left.
    for (let i = 0; i < 3 && s.includes('\u0000'); i++) s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[Number(n)]);
    return s;
  };

  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  const para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const text = para.join('\n');
    const embed = PRODUCT_TOKEN.exec(text.trim());
    out.push(embed ? card(embed[1]) : `<p>${inline(text)}</p>`);
    para.length = 0;
  };
  const LIST = /^\s*([-*+]|\d+[.)])\s+/;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    const h = /^(#{2,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length;
      const text = h[2].trim();
      out.push(level === 2 ? `<h2 id="${slugify(text.replace(IMAGE_TOKEN, ''))}">${inline(text)}</h2>` : `<h${level}>${inline(text)}</h${level}>`);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push('<hr>');
      i++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote><p>${inline(q.join('\n'))}</p></blockquote>`);
      continue;
    }
    if (LIST.test(line)) {
      flush();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && LIST.test(lines[i])) {
        let item = lines[i].replace(LIST, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !LIST.test(lines[i])) item += '\n' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush();
      const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => inline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows: string[] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(`<tr>${cells(lines[i++]).map((c) => `<td>${c}</td>`).join('')}</tr>`);
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return out.join('\n');
}
