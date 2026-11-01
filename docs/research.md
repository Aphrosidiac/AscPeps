# Research (/research)

Research summaries: what published studies report about each compound, every finding tied to a cited
study with its DOI and PubMed links. Ported from Teliti Peptides (`~/Desktop/dev/AscComp`): the storefront
section from its Astro pages, the admin from its Vue admin, component by component. One addition Teliti
doesn't have: photos placed anywhere in an article's text, mid-sentence included.

Research replaced Insights on 2026-11-01. Every Insights article was moved here with its slug
(`backend/scripts/migrate-insights-to-research.ts`: plain text → markdown headings and lists, its
citation → a library study, figures → photos at the end of the text, author → Writers & reviewers;
published stays published, drafts stay drafts). `/insights` and `/insights/<slug>` 308 to `/research`
and `/research/<slug>` (`frontend/next.config.ts`), and the admin's Insights and Comments pages
redirect to Admin → Research. Comments went with Insights: research articles have none, so accounts no
longer mention them. The Insights tables and API are still in the database and backend, unused by the
site.

## Storefront

| Route | File | Notes |
|---|---|---|
| `/research` | `frontend/src/app/research/page.tsx` | Hub: title, intro, illustration (`RESEARCH_HUB.art`), one row per live article. 404 while nothing is live (an empty hub would be a thin page), and the header's Research link only shows once an article is live. JSON-LD: CollectionPage + ItemList + BreadcrumbList |
| `/research/[slug]` | `frontend/src/app/research/[slug]/page.tsx` | Article. A renamed or deleted URL 308s to where it went (one hop); "gone" answers 404 (the App Router has no 410) |

- The look is Teliti's, measured: spacing, type steps, column widths (680 px reading column, 220 px sticky
  contents list at ≥ 1100 px) and breakpoints (760 / 1000 / 1100 / 1200) are its values
  (`frontend/src/app/research/research.css`), and so are its type and colours: IBM Plex Sans 400/500
  (`lib/research-font.ts`, self-hosted by next/font), Paper, Ink, Graphite and Rule. Links are Ascend Cobalt.
  The hub lines up with Ascend's header instead of Teliti's wider wrap (24 px).
- The hub illustration is Ascend's own line drawing (Ink, one Cobalt detail), made with
  `frontend/scripts/research-art.mjs` (OpenRouter `openai/gpt-5.4-image-2`, ~$0.16 an image). Teliti's art,
  copy and photos may not appear here (Teliti DECISIONS #19), so the hub's H1, title and intro are Ascend's
  own words too.
- `ResearchArticleView` renders the article; the admin preview uses the same renderer.
- `lib/research-markdown.ts` is the one body renderer (server page and admin preview): escape-first
  markdown allowlist, `##` headings get Teliti's ids, `{{product:<id>}}` on its own line is a product card
  from the catalogue, `{{image:<id>}}` anywhere is a photo.
- A photo renders as `<span class="rs-img" role="figure">` inside its paragraph, so a sentence interrupted
  by a photo stays one valid `<p>` (no browser re-parenting, no hydration mismatch). `<img>` has
  width/height (no layout shift), lazy loading, and a `/_next/image` srcset sized for the 680 px column.
- SEO: canonical, OG article dates and image, Article JSON-LD (author Person or the Organization, reviewer,
  every placed photo in `image`, each cited study as CreativeWork + `additionalType` ScholarlyArticle;
  not ScholarlyArticle itself, which Google reads as an Article rich result and flags), sitemap entries
  with the article's `dateModified`, a section in `llms.txt`, and a Research link in the header.
- Server fetches carry the `research` tag; every publish, unpublish, rename and delete revalidates it.

## Data (`backend/prisma/schema.prisma`, migration `20261101000000_add_research`)

| Model | What |
|---|---|
| `ResearchArticle` | The draft fields, plus `live` (JSON: the complete public article as of the last publish, people/studies/photos included), `liveAt`, `slugLockedAt` |
| `ResearchSource` | One study, cited by any number of articles. PMID and DOI unique; a PMID, DOI or URL is required |
| `ResearchCitation` | A source as one article cites it: position + what this article says it found. Source deletion is RESTRICTed |
| `ResearchImage` | A photo of one article: file, size, alt, caption, credit. The text refers to it by id |
| `ResearchAuthor` | A real person who writes or reviews. No author = "Ascend MY editorial team" |
| `ResearchRedirect` | A research URL without its own article: `toPath` (301) or null (gone) |

Publish states: **Never published** (no live copy, URL free) · **Live** · **Changes not live** (saved draft
differs from the live copy, compared key-order-independently since JSONB reorders keys) · **Offline**
(taken down, URL stays locked).

## Admin (`/admin/research`, `/admin/research-sources`, `/admin/research-people`)

Teliti's admin, ported: the kit (`frontend/src/components/admin/tl/`: Btn, Chip, Segmented, Field, Hint,
PageHeader, Toggle, FileDrop, Modal, Counter, SerpPreview, DataTable, toasts; `tl.css` is Teliti's
tokens and component styles in Ascend's colours, scoped under `.tl`) and the editor pieces
(`components/admin/research/`): EntityList, EditorFrame, RecordSide, LockedPath, DeleteDecision,
SeoFields, ImageField, MultiPick, ProductCardPicker, MarkdownEditor.

- **Save draft** (or ⌘S) writes the draft only; leaving with unsaved work asks first.
- **On the site** publishes the saved draft (the API runs the pre-check first: H1 10–90, dek 40–260,
  SEO title 20–65, meta description 70–160, lead image + alt 10–160, body, ≥ 2 studies each with a
  finding, alt on every placed photo). **Publish changes** sends later edits. Off takes it down.
- The side column: publish state, URL / URL lock / live since, the API's **Pre-check**, the live
  **Contract check** (same rules, client-side; click an item to jump to the field).
- **URL lock**: the slug locks at the first publish. **Rename…** records a 301 from the old URL and
  repoints any redirect that pointed at it, so nobody takes two hops.
- **Delete…**: a draft that never went live is removed. A URL that has been live must 301 to another
  live page (never the homepage) or be marked gone.
- **Cited studies**: add from the library or as a new study (PMID → **Fetch** fills title, journal, year
  and DOI from PubMed's public E-utilities). Teliti edits these on product records; here they are edited
  in the article.

### Photos in the text

- **Photo** in the toolbar uploads and places the photo at the cursor; pasting an image or dropping an
  image file on the text places it where it lands (a hidden copy of the textarea is hit-tested for the
  character under the pointer).
- Each photo's card: alt text (required to publish), caption, credit, credit link (saved as you leave the
  field); **Place / Move to cursor**; drag the thumbnail onto the text to place or move it;
  **Find in text**; **Replace** swaps the file and keeps its place; **Remove** takes it out of the text and
  the article.
- **Side by side** shows the text and the rendered preview together; clicking a photo in the preview
  selects its token in the text.
- A new article is created the first time it is saved or a photo is added; the address moves to its id
  without remounting the editor.
- Uploads go through the existing `POST /api/v1/admin/upload/image` (WebP, ≤ 1600 px), which now also
  returns the stored file's width and height.

## Content

`backend/scripts/import-teliti-research.ts` imports Teliti's English research posts (sources, citations,
lead images, live copies with Teliti's dates). **Local only.** Teliti's DECISIONS #19 forbids copied copy
or photos between the two brands, and the same text on both sites would compete with itself: rewrite
every article and replace the lead images (they carry Teliti's logo) before anything here goes live. Teliti's
hub art in `frontend/public/research-standin/` is local only and never committed.
