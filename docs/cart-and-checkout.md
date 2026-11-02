# Cart, checkout and Buy now

How a shopper gets from a product to a placed order: the product page's two
buttons, the slide-in cart, the cart page and the one-page checkout. Rebuilt
on branch `feat/ascend-affiliate` (2026-11-03) in **our common store style**
— the same pattern as Teliti, BuatBenda and BayangPortfolio, which follow
Shopify's. Not deployed yet; it ships with the affiliate work.

Payments themselves (gateways, callbacks, refunds) are in
[payments.md](payments.md); what an order includes in
[add-ons.md](add-ons.md); pre-orders in [preorder.md](preorder.md).

---

## Why it changed

The old flow worked but leaked shoppers in four places, and looked unlike our
other stores:

| Before | Now | Why it converts better |
|---|---|---|
| "Added to cart" toast, then a full `/cart` page | A **slide-in cart** over the page they are on | They see the item went in and the total, then go to checkout or keep browsing without losing their place — more items per order |
| Cart showed only items and a total; **shipping appeared at checkout** (RM 210 became RM 220) | The cart shows **shipping before checkout** | A cost that only appears at checkout is the abandonment reason shoppers give most in Baymard's surveys |
| No way to skip the cart | **Buy now** goes straight to checkout | One tap for someone who already knows what they want |
| Checkout: numbered cards in a narrow column, four payment tiles, a sticky summary with the button | **Shopify-style one-page checkout**: form on white, the order on a panel to the right edge, payment as one radio list, no store chrome | Fewer distractions, a familiar layout, the total always in view |
| Empty cart was a dead end | Empty cart shows the featured products | Something to pick instead of a back button |

What stayed exactly as it was: what the server charges and validates, stock,
pre-orders, the East Malaysia minimum, discount codes, every payment method
and what happens after the order is placed.

## The flow

```
 product page ── Add to Cart ──► slide-in cart ── Checkout ──► /checkout ──► payment
      │                               │  └─ Keep browsing (closes)
      │                               └─ View cart ──► /cart ── Checkout ──┘
      └────────── Buy now ─────────────────────────────────────► /checkout
                 (adds to the cart quietly; backing out finds it there)
```

## Product page: Add to Cart and Buy now

`frontend/src/app/products/[slug]/AddToCartPanel.tsx`

- **Add to Cart** (black, beside the quantity) adds the selection — size,
  quantity, ticked add-ons — and opens the slide-in cart with it on top. The
  button then reads **View cart (n)**, which opens the slide-in cart again,
  until the selection changes.
- **Buy now** (Ascend **Cobalt** `#3155D9` from the brand kit, a lightning
  icon, a soft glow; 12 px under the row) puts the same selection in the cart
  **without** opening anything and goes to `/checkout`. If that size is
  already in the cart — added a moment ago, or from a Buy now they backed out
  of — it is not added again; checkout shows it and Edit cart changes it.
  Pre-order-only sizes read **Pre-order now**.
- **Phone sticky bar** (once the inline buttons scroll away): the price,
  **Add** (black) and **Buy now** (cobalt) side by side, sized to fit 375 px.
- Analytics: both fire `add_to_cart` with `via: add_to_cart | buy_now`.

The Button component has a `buy` variant for this (`components/ui/Button.tsx`),
and the colour is a store token: `--color-cobalt` / `--color-cobalt-deep`
(hover) in `app/globals.css`. White on cobalt is 5:1.

## The slide-in cart

`frontend/src/components/cart/CartDrawer.tsx`, mounted once inside
`CartProvider` (`lib/cart.tsx`).

**Opens** on Add to Cart (any product card or product page — `addItem` /
`addItems`), from the header's cart icon (`Navbar`; a plain click — a
middle-click or ⌘-click still opens `/cart`; on `/cart` itself it just goes
there), and from **View cart (n)**. `addItems(lines, { quiet: true })` adds
without opening it (Buy now).

**What is in it**, top to bottom: "Your cart · n" and ✕; "✓ Added to your
cart" when it was opened by an add, with that line first; the lines (below);
then a footer panel with the totals, **Checkout**, **Keep browsing** and
**View cart**. Empty, it says so with a Keep browsing button.

**Behaviour**: a modal `<dialog>` — focus moves into it and stays there;
Escape, ✕, the backdrop or leaving the page closes it; the page behind can't
scroll (`html:has(.cart-drawer[open])`). 440 px from the right on a desktop,
the full width on a phone; slides in over 220 ms (none with reduced motion).
Its content is only built while open. Styles: `.cart-drawer` in
`app/globals.css`.

## Cart lines and totals (shared)

`frontend/src/components/cart/cart-shared.tsx` — used by the slide-in cart
and `/cart`, so the two can't drift.

**A line**: thumbnail; code, name, "RM x each" when more than one; a
pre-order label when part of it waits for a restock; **Included free:** with
the supplies as one sentence (`12× Alcohol Swab, 8× Syringe 1mL, …` — scales
with the quantity) and any priced include on its own line with its price; a
− / + stepper (capped at what stock, or the pre-order limit, allows) and
**Remove**; the line total.

**Remove** takes the line out and shows "Removed RT20. Undo" for 8 seconds;
Undo puts it back where it was (`restoreItem` → `RESTORE_ITEM`). Removing
still fires `remove_from_cart`.

**Totals** (`CartTotals`):

| Line | Rule |
|---|---|
| Subtotal | the lines, as the cart prices them |
| Shipping | one fee when Peninsular and East Malaysia cost the same; otherwise two lines, "Shipping, Peninsular" and "Sabah, Sarawak, Labuan"; **Free** when every line is a no-shipping product |
| Total (MYR) | only when there is one fee to add; with two, checkout totals it once a state is picked |
| Notes | the East Malaysia minimum while the subtotal is under it; the pre-order shipping note; "Code X from your link is ready to apply at checkout" |

Fees come from the store settings `shipping_fee`,
`east_malaysia_shipping_fee`, `east_malaysia_min_order`, fetched once per
visit, through the same helpers checkout uses (`lib/shipping-region.ts`). The
server still decides what is charged.

## The cart page

`frontend/src/app/cart/page.tsx` (server: fetches 4 featured products, or any
4) and `CartView.tsx` (client).

Lines on the left, a **Summary** card on the right (sticky on desktop):
`CartTotals`, **Checkout**, **Keep browsing**. Nothing is drawn until the cart
has loaded from `localStorage`, so it never flashes "empty". An empty cart
says so, links to all products, and shows **Featured products** — named that
because they are the ones marked featured in admin, not a sales ranking.

## Checkout

`frontend/src/app/checkout/page.tsx`. Only the layout and a few fields
changed; the order logic (validation, idempotency key, analytics, payment
hand-off, the WhatsApp success view) is as it was.

**Chrome**: `SiteChrome` leaves `/checkout` bare — no announcement bar, nav,
footer, chat bubble or popups — and the page draws its own logo-only header.
The success and failed pages keep the normal chrome.

**Layout**: on a desktop, the form on white on the left and **Your order** on
a grey panel running down the right edge; on a phone, the order folds into a
"Show order summary · RM…" bar above the form. A breadcrumb: Cart › Details
› Payment.

**Form**, in this order (also the order validation jumps through):

| Section | Fields |
|---|---|
| Contact | Email — optional for WhatsApp, required for online, bank transfer and Bitcoin (the label or the hint under it says why); the restock-email tick once there is an address |
| Delivery | Full name, Address, **+ Add apartment, unit or floor** (folded until asked for), Postcode, City, State, Phone with a fixed **+60**, **+ Add a note to your order** |
| Payment | One bordered list of radio rows — Bank transfer (when switched on), WhatsApp, Online payment (greyed with the reason when off), Bitcoin ("Soon" until live). The chosen row opens what happens next |

Fields have their labels inside them (they move up once there is a value).
The East Malaysia minimum warns under the state as soon as one is picked.
At the bottom: **‹ Back to cart** and **Place order** — **Continue to
payment** for the methods that go to a payment page.

**Your order panel**: each line with a thumbnail and quantity badge, **Edit
cart**, the discount box (and the share-link code offer), Subtotal, Discount,
Shipping (by the chosen state), Total in MYR.

**What changed in what is sent** (`createOrder`):

- `phone` is `+60` + what was typed, with a leading `0` or `60` dropped first,
  so `12-345 6789`, `012-345 6789` and a pasted `+6012…` all arrive as
  `+60123456789`; the server stores `0123456789` (`normalizePhone`).
- `address` is the address and the apartment line joined with ", ".

Removed: the "Secure · Verified · Shipping" row (none of the other stores
carry one) and the numbered step cards.

## Where the code is

| | |
|---|---|
| Cart state, drawer state, Undo | `frontend/src/lib/cart.tsx` |
| Slide-in cart | `frontend/src/components/cart/CartDrawer.tsx` |
| Lines, Remove + Undo, totals | `frontend/src/components/cart/cart-shared.tsx` |
| Cart page | `frontend/src/app/cart/page.tsx`, `CartView.tsx` |
| Checkout | `frontend/src/app/checkout/page.tsx` |
| Bare chrome on checkout | `frontend/src/components/layout/SiteChrome.tsx` (`isCheckout`) |
| Header cart icon | `frontend/src/components/layout/Navbar.tsx` |
| Add to Cart / Buy now | `frontend/src/app/products/[slug]/AddToCartPanel.tsx` |
| `buy` button, cobalt token, drawer CSS | `components/ui/Button.tsx`, `app/globals.css` |

The old toast (`components/ui/CartToast.tsx`) is gone.

## Checking it

There are no automated UI tests for this; it was clicked through at desktop
width and 375 px: add → slide-in cart, header icon, stepper, Remove → Undo,
Escape, the cart page full and empty, Buy now (and backing out, and Buy now
twice), checkout validation, the referral code, and the order request caught
in the page before it was sent (no real order was placed).

To repeat it locally: start the API and web, open a product, and use the
flow above. Never place a real online order to test — that is Fakhrul's.

**Dev-server trap.** Running `next build` while `next dev` is up shares the
`frontend/.next` folder, and the dev server can go on serving an old
stylesheet afterwards (a new CSS rule simply isn't there). Stop the dev
server, delete `frontend/.next/dev`, start it again.

## Decisions, and why

| Decision | Why |
|---|---|
| The same pattern as our other stores | One way of buying across Teliti, BuatBenda, Bayang and Ascend; it's the Shopify pattern shoppers already know |
| Buy now in **Cobalt**, under Add to Cart | Fakhrul wanted it "enticing to just press"; cobalt is the brand kit's only blue; Add to Cart stays the main black button |
| Buy now adds to the cart, not a separate one-item checkout | If they back out, the item is waiting in the cart |
| Shipping shown in the cart, total only with one fee | Shows the real cost early without guessing the state |
| "Included free" as one line, not a box | The box read as a separate thing hanging off the line (Fakhrul: "weird layout") |
| Checkout without the store's chrome | Nothing between the shopper and paying |
