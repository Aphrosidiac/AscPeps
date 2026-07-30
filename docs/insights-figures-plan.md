# Figures for Insights — integration plan

Goal: let an Insight carry labelled figures with captions, the way a PubMed
article does — a numbered figure set the prose can refer to ("see Figure 1"),
each with its own caption and credit.

Nothing here is built yet. This is the proposal.

---

## 1. What we're building on

Worth being precise about the starting point, because it decides the whole
design:

- **`Insight.content` is a plain-text blob.** It renders as a single `<p>` with
  `whitespace-pre-line` (`app/insights/[slug]/page.tsx`). There is no markdown,
  no HTML, no block structure — line breaks are the only formatting that exists.
- **The admin editor is a bare `<textarea>`.** No rich text, no toolbar.
- **There is no markdown library in the project.** `frontend/package.json` has
  axios, clsx, lucide-react, next, posthog, react, zod. That's it.
- **Image upload already works well.** `POST /api/v1/admin/upload/image`
  validates magic bytes (not the spoofable Content-Type), re-encodes everything
  to WebP at quality 82, caps at 5MB, and returns `/uploads/products/<uuid>.webp`.
  Cover images and product images already use it.
- An Insight already has **one** `coverImageUrl`, plus a single referenced study
  (`citationTitle` / `citationSource` / `citationUrl`).

The important consequence: **there is currently no way to position anything
inside the body text**, because the body has no structure to position against.

---

## 2. The core decision

### Option A — Figure gallery after the body *(recommended)*

Figures live as their own ordered collection on the Insight and render as a
labelled grid below the article body. The prose refers to them by number.

This is exactly what the PubMed page does, and it's the only option that needs
**no change to how `content` is stored or edited**.

- Cheap: one new table, one admin section, one render block.
- No new parsing, no sanitisation surface, no editor rewrite.
- Matches the reference design directly.
- Trade-off: a figure can't sit mid-paragraph. For a research write-up that
  cites "Figure 2" in passing, that's how papers work anyway.

### Option B — Inline placeholders

Author types `[figure:2]` on its own line in the body; the renderer splits the
plain text on those tokens and drops the figure in.

- Adds positioning without a rich-text editor.
- Same data model as A — this is a **rendering** change, not a schema change.
- Trade-off: a hand-typed token is easy to typo, and a token pointing at a
  deleted figure needs a defined fallback (render nothing, silently).

**A and B compose.** Ship A; add B later as a pure renderer change if placing
figures mid-article turns out to matter. Nothing gets thrown away.

### Option C — Real rich text / markdown

Add a markdown pipeline and a proper editor.

- Genuinely more flexible, and the right destination eventually.
- Much bigger: new dependency, a sanitisation story (HTML injection is a real
  risk on an admin-authored field), an editor UI, and a migration for existing
  plain-text articles.
- Not justified by "we want figures". Wrong tool for this ask.

**Recommendation: A now, B when needed, C only if Insights grows into a real
publishing surface.**

---

## 3. Data model

```prisma
model InsightFigure {
  id        String  @id @default(cuid())
  insightId String
  // 1-based, and it IS the label the reader sees ("Figure 3") and the number
  // the prose refers to. Not a hidden sort key.
  order     Int
  imageUrl  String
  caption   String
  // Required in the admin form, not at the DB level — scientific figures are
  // meaningless to a screen reader without one, but an empty string must not
  // block a migration.
  altText   String  @default("")
  // Attribution shown under the caption, e.g.
  // "Adapted from Doe et al., Biomolecules 2025 (CC BY 4.0)".
  credit    String?
  creditUrl String?

  insight Insight @relation(fields: [insightId], references: [id], onDelete: Cascade)

  @@unique([insightId, order])
  @@index([insightId])
  @@map("insight_figures")
}
```

**Why a table and not a `String[]` like `relatedProductIds`?** The existing
schema comment on `relatedProductIds` says a join model would be "pure overhead"
there *because it has no per-relation attributes*. Figures are the opposite
case: caption, alt text, credit and order are all per-row. Same reasoning, other
conclusion.

`onDelete: Cascade` — a figure has no meaning without its article.

---

## 4. Admin experience

A **Figures** section in `InsightForm`, below the body field. Same repeatable-row
shape as Extra Costs on the order detail page, so it's already a familiar
pattern in this codebase:

```
Figures                                            [+ Add figure]
┌──────────────────────────────────────────────────────────────┐
│ ⠿  [thumbnail]   Figure 1                              ✕     │
│                  Caption      [_______________________]      │
│                  Alt text     [_______________________]      │
│                  Credit       [_______________________]      │
│                  Credit link  [_______________________]      │
└──────────────────────────────────────────────────────────────┘
```

- Upload reuses `POST /admin/upload/image` unchanged.
- Reordering by ⠿ drag, or plain ↑/↓ buttons — figure numbers renumber
  automatically, since `order` is the visible label.
- Saved with the rest of the form (one `PATCH /admin/insights/:id`, figures
  replace-all), matching how the profit split saves.
- Alt text validated as required in the form.

**One upload caveat to fix here:** the endpoint re-encodes to WebP but does
**not resize**. A 5MB screenshot of a journal figure stays enormous. Figures
should be capped (say `sharp().resize({ width: 1600, withoutEnlargement: true })`)
or an article with six figures will be a very heavy page.

---

## 5. What the reader sees

Placed **after the article body, before the Referenced Study block** — so the
prose, then its evidence, then the citation it came from.

```
… article body text …

FIGURES
┌────────────────────────┐  ┌────────────────────────┐
│                        │  │                        │
│    [figure image]      │  │    [figure image]      │
│                        │  │                        │
├────────────────────────┤  ├────────────────────────┤
│ Figure 1  Retatrutide's│  │ Figure 2  The present  │
│ mechanisms of action.  │  │ and future of …        │
│ Adapted from Doe 2025  │  │ Adapted from Doe 2025  │
└────────────────────────┘  └────────────────────────┘

┌──────────────────────────────────────────────────┐
│ REFERENCED STUDY  …existing block, unchanged…    │
└──────────────────────────────────────────────────┘
```

- **Two-up on desktop, one-up on mobile** — matches the reference, and the
  article column is only `max-w-3xl`, so three-up would make figures unreadably
  small.
- Image sits on a **light neutral panel** (`bg-surface-elevated`) with the image
  `object-contain`, not `object-cover`. Scientific figures are diagrams with
  text in them — cropping to fill would cut off labels. This is the single
  most important visual detail.
- Caption: **"Figure N"** in semibold, then the caption text. Credit in smaller
  muted text below, linked if `creditUrl` is set.
- **Click to enlarge.** Non-negotiable for figures — a diagram at 350px wide in
  a two-column grid is unreadable. A simple lightbox (full-screen overlay,
  click-anywhere/Esc to close) is enough; no zoom/pan library needed.
- If an article has no figures, the whole section renders nothing. No empty
  state — most Insights won't have figures.

---

## 6. SEO and accessibility

- Add figure URLs to `ArticleJsonLd`'s `image` array (it currently only carries
  the cover). Google uses that array for article rich results, and figures are
  genuinely the article's images.
- Use semantic `<figure>` / `<figcaption>` rather than divs — free structure for
  crawlers and screen readers.
- `alt` comes from `altText`, never from the caption. A caption says "Figure 1
  Retatrutide's mechanisms of action"; alt should describe what's actually
  drawn.
- Uploaded figures are already served from `/uploads` under the strict CSP, and
  `next/image` is already configured for that path (the cover image uses it).

---

## 7. The thing to decide before building: copyright

Figures in published papers are **usually copyrighted**, and this is the part
worth your call rather than mine.

- The paper in the reference screenshot is MDPI *Biomolecules*, which is
  **CC BY 4.0** — reusable with attribution. That's the good case.
- Most closed-access journals (Elsevier, Springer, NEJM, JAMA) are **not**.
  Lifting a figure from one of those onto a commercial storefront is
  infringement, and this site already sits in a regulated, compliance-sensitive
  space.

Concretely, that means:

1. `credit` / `creditUrl` should be **effectively mandatory**, not optional
   decoration — the form should push hard for them.
2. Worth adding a `licence` field (free text, e.g. "CC BY 4.0") so the source
   licence is recorded at the time of upload, while whoever added it still
   remembers.
3. Safest default is **redrawing** figures in our own style rather than
   screenshotting the paper. Ideas aren't copyrightable, a specific rendering
   is — and a redrawn diagram in ASCEND's visual language looks far better than
   a screenshot of a PDF anyway.

---

## 8. Suggested order of work

| Step | Work | Notes |
|---|---|---|
| 1 | `InsightFigure` model + migration | Nullable/additive, safe on prod |
| 2 | Include figures in the insight read endpoints | Public + admin |
| 3 | Admin Figures section in `InsightForm` | Reuses existing upload endpoint |
| 4 | Cap upload dimensions in `admin-upload.routes.ts` | Prevents 5MB figures |
| 5 | Reader-side `<figure>` grid + lightbox | The visible feature |
| 6 | Figures into `ArticleJsonLd.image` | SEO |
| 7 | *(later, optional)* `[figure:N]` inline placeholders | Pure renderer change |

Steps 1–6 are a single, self-contained change. Step 7 only if placing figures
mid-article turns out to matter.
