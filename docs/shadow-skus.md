# Shadow SKUs

A shadow SKU is the generalised name a product is listed under on internal
paperwork. `Retatrutide 10mg` becomes `Research peptide, 10mg vial`: less
specific, still true.

It exists so that a sheet which has no need to name a compound does not name
one — a stock count, a supplier PO, an order summary read by someone who
shouldn't have to learn the catalogue.

## What it is not

The customer-facing side of the shop is untouched by this feature and always
shows the real product: storefront, cart, checkout, order confirmation email,
and the customer's receipt (`utils/receipt-pdf.ts`). Nothing in this feature
writes to any of them.

The internal summary is **not a second receipt**, and three things in
`utils/internal-summary-pdf.ts` are deliberately not configurable so it cannot
drift into being one:

- a fixed banner — *INTERNAL SUMMARY — GENERALISED ITEM DESCRIPTIONS · Not a
  receipt. Not valid as a record of sale.*
- the real order number on the page, so any copy reduces back to the real order
- a footer naming the customer receipt as the record of sale

It also does not reuse the receipt's logo and letterhead block. Two documents
for one order that look alike is how the wrong one ends up in front of the wrong
person.

Money is never shadowed. Quantities, unit prices, discounts, shipping and the
total are copied from the order unchanged, which is why the sheet's total and
the receipt's total are the same figure by construction rather than by
agreement.

## Data model

| Table | Column | Why |
|---|---|---|
| `shadow_skus` | `code`, `name`, `description`, `active` | The vocabulary itself. `code` is unique and scannable. |
| `product_variants` | `shadowSkuId` | Plain FK, `ON DELETE SET NULL`. Many variants deliberately share one shadow. |
Migrations: `20260906020000_add_shadow_skus`, then
`20260906030000_drop_shadow_snapshot`.

### Many-to-one, on purpose

The FK is not unique. The common shape of this data is a dozen 5mg vials
collapsing onto one generic line, and that is a feature rather than an accident
of modelling. If per-channel shadows are ever needed (one name on a PO, another
on a stock sheet) the FK becomes a join table with a `channel` column and
nothing else changes.

### Nothing is frozen

Resolution is always live against the current mapping. An earlier version of
this froze each line's wording onto `order_items` the first time a sheet was
produced, on the reasoning that a document already handed to someone has to stay
reproducible.

That reasoning does not apply here. The sheet never leaves the business and is
regenerable on demand, so freezing bought nothing and cost something real: an
old sheet quietly disagreeing with the mapping an admin is looking at, and a
produce-then-download step in the UI that existed only to service the freeze.
Change a shadow name now and every sheet says the new thing, which is what
anyone editing a mapping expects.

`20260906030000_drop_shadow_snapshot` removes the columns.

### Unmapped is refused, never defaulted

If any line of an order has no shadow, `GET .../summary.pdf` returns 400 and
names the offending SKUs. It does **not** fall back to the real product name.

Falling back would put the real name on the one document whose entire purpose is
not to carry it, and would do so silently — the sheet would look complete. This
is why coverage is the headline on the admin page rather than a statistic buried
in it.

## API

All routes are under `/api/v1/admin/shadow-skus` and every one of them, the PDF
included, sits behind `fastify.authenticate`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/` | The shadow catalogue, with a live count of SKUs using each code. |
| `POST` | `/` | Create. `code` is `[A-Za-z0-9._-]+` only. |
| `PATCH` | `/:id` | Rename, re-describe, activate/deactivate. |
| `DELETE` | `/:id` | Refused if referenced. See below. |
| `GET` | `/coverage` | Mapped / unmapped counts over **active** variants. |
| `GET` | `/mapping` | One row per real SKU. `?unmapped=true` is the gap list. |
| `PUT` | `/mapping` | Bulk assign or unassign. `shadowSkuId: null` unmaps. |
| `GET` | `/orders` | The backlog: every order with its sheet state. `?state=ready\|blocked`. |
| `GET` | `/orders/:orderRef/summary` | Preview. Reads and writes nothing. |
| `GET` | `/orders/:orderRef/summary.pdf` | Renders the sheet. Pure read. |

### Two things that bite

**Order numbers contain a slash.** `ASC2608/0022` in a path parameter needs
encoding as `ASC2608%2F0022`, which Fastify handles correctly once encoded. The
frontend passes the order **id** instead, which never needs it. The same slash
is stripped out of the `Content-Disposition` filename — a path separator has no
business in one — so the file saves as `ASC2608-0022-internal-summary.pdf`.

**The preview and the PDF are two views of one answer.** `/summary` returns the
resolved lines with the real product beside each — the admin needs to see which
real thing became which line, and the sheet deliberately does not carry that.
`/summary.pdf` renders the same resolution. Both are pure reads and can be asked
for as often as anyone likes.

### Deleting a shadow code

Refused while any variant still points at it — unmap them first, or deactivate.

Deactivating is the gentler retirement path, the same rule as
`ProductVariant.active`: it takes the code out of the assignment dropdowns
without disturbing anything already mapped to it. The admin panel leads with the
Active/Inactive toggle and treats Delete as the exception.

An inactive code that is still mapped to a row stays selectable in that row's
dropdown — otherwise opening the dropdown would silently rewrite the row to
"not mapped".

## Admin

`/admin/shadow-skus`, two views behind one page.

**Mapping** is one row per *real* SKU, not per shadow code, because "what does
this product show up as?" is the question with a direction; reading the join the
other way means holding it in your head. Bulk select plus one assign is on the
main path rather than hidden, since mapping twelve vials one row at a time is
the difference between a minute and an afternoon.

**Coverage** leads the page and the unmapped count is a filter, not a number —
what people arrive wanting to know is what is still missing.

Three layout constraints worth not undoing:

- **The table scrolls inside itself** (`max-h-[65vh] overflow-auto`) rather than
  with the page. That is what makes the sticky header work at all: the admin
  layout's `<main>` carries `overflow:auto` but never actually scrolls — the
  document does — so a header sticking to `<main>`'s scrollport would never
  move. Capping the height gives it a scrollport that really scrolls, and keeps
  coverage and the filters on screen while you work down the list.
- **Unmapped rows are not painted amber.** Most of the catalogue is unmapped at
  any moment, and sixty warning-coloured rows make the colour mean nothing. The
  coverage chip and the filter carry that signal.
- **The bulk bar is pinned to the bottom** and offset past the fixed `w-64`
  sidebar (`left-0 lg:left-64`). Mapping a dozen SKUs means scrolling, and an
  action bar that scrolls away from the rows it applies to is no use.

**Order sheets** is the backlog — every order, filtered Ready or Blocked. Both
states are Prisma filters, not a post-fetch pass over the page, so the counts
describe the whole collection rather than the fifty rows that happened to arrive.

The whole row opens `InternalSheetDialog`, which is the answer to "let me look at
this one": the mapping on the left (real product → printed line, with unmapped
items flagged) and the rendered PDF on the right, in an iframe fed by a blob —
the token is in localStorage, so a plain `src` would arrive unauthenticated.
Downloading is a button inside that dialog rather than a step you must take to
see anything.

Each order also carries an **Internal summary** panel on its Info tab, directly
under the real item table. It is a panel and not a fifth tab because the order's
tab bar is tuned to exactly four labels on a phone, and because the comparison
with the real lines immediately above it is the point. **View sheet** opens the
same dialog.

## Agent

Domain `shadow`, in `modules/ai-agent/tools/shadow.tools.ts`. Five tools:
`list_shadow_skus`, `shadow_coverage`, `list_shadow_mapping`,
`set_shadow_mapping` (write), `preview_internal_summary`.

Two boundaries:

- **The agent never renders the sheet.** There is no PDF tool — the document is
  a thing a person looks at in the admin, not something to hand out over
  WhatsApp. `preview_internal_summary` returns the wording only.
- **Every response carries an internal-only note.** The agent also talks to
  customers, and shadow names mean nothing to someone who ordered a named
  compound. Without the note the model will cheerfully tell a buyer their order
  contains `1x Research peptide, 5mg vial`.

Registered in exactly one domain bucket: `ALL_TOOLS` is a flatMap over domains
and the duplicate-name check at the bottom of `registry.ts` throws at boot on a
repeat. Nothing is lost, because `routeDomains` returns every domain a message
matches.

## Tests

`npm run test:agent:tools` exercises all five (`preview_internal_summary` gets a
sample order from `INPUTS`).
