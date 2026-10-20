# Add-ons

A product can offer other variants on its page through `ProductAddOn`
(`productId` → `addOnId`, with `required` and `quantity`). Since 2026-10-20
those add-ons come in two kinds, told apart by **the add-on's own product**:

| | Included | Suggested |
|---|---|---|
| What it is | a supply that only exists to go with something — the add-on's product has **Add-on only** on (Bac Water, syringes, alcohol swabs, empty vials) | a real product offered alongside (MOTS-C and AOD9604 on Retatrutide) |
| In the cart | under the product it came with, as "Included" — no quantity stepper, no delete, removed with the product, not counted as an item | a line of its own, like anything else |
| Quantity | `quantity` × the product's quantity — 2× RT20 brings 2 Bac Water and 12 swabs | `quantity`, once, when ticked |
| Required | always included; the checkbox is locked | added as its own line at checkout if missing (old behaviour, kept) |
| Optional | the customer ticks it (a 5 mL vial for RM50); a priced one adds its price to the product's line | the customer ticks it |
| In the order | an `OrderItem` with `parentItemId` pointing at the product's line | an ordinary `OrderItem` |

Admin → Products shows each configured add-on as **Included** (its quantity
reads "each") or **Suggested**, so the setting explains itself.

## Who decides what is included

The server. `resolveOrderLines` in `backend/src/utils/order-lines.ts` builds an
order's lines from the product settings: every required included add-on, plus
the optional ones the cart lists in `items[].addOnIds`. The client never sends
supplies as lines. Checkout and the assistant's order preview both go through
it, so what an operator is shown before confirming is what the order holds.

It also:

- **folds old carts** — a cart saved before bundles sent each supply as its
  own line; a line whose product is add-on-only and that another line lists as
  an add-on is folded under that line instead;
- **merges** identical lines (same size, same included choices);
- **checks stock per variant across every line and include**. A product, or a
  priced include, must be fully in stock. A **free** include that is short
  ships what is left (logged as `Included free supply short`) instead of
  blocking the product — Retatrutide's Bac Water was down to 3 when this was
  written.

## Showing an order

Every place that lists an order's lines uses `groupOrderItems` (backend
`utils/order-lines.ts`, mirrored in `frontend/src/lib/order-lines.ts`):
each chosen product with "Includes …" under it, a priced include added to the
product's amount. That covers the confirmation and receipt emails, the
WhatsApp order message, the PDF receipt, the bank-transfer page, the
operators' order notice, Track Order, the receipt page, the admin order list
and detail, and the assistant's `get_order` (which marks an included line with
`includedWith`).

Orders placed **before** 2026-10-20 have no `parentItemId`: their supplies are
separate RM0 lines. Those are recognised by price 0 + an add-on-only product
and shown as one "Included" group, never as purchases.

## Changing an order

Admin item edits and the assistant's `set_order_items` act on **products**.
Change a product's quantity and its included lines follow at the same
per-unit ratio; remove it and they go with it; add a product and it brings its
required includes. An included line listed on its own is ignored. Old orders'
loose RM0 supply lines are left exactly as they are.

## Money and reports

- **Profit**: a free line (unit price 0) may stay uncosted — it counts as RM0
  cost instead of holding the whole order's profit as unknown. Priced lines
  still need their cost.
- **Top products** (dashboard and the assistant's `top_products`) and the
  **month-end** wrap count products bought; included supplies are counted
  separately as supplies. Before this, month-end filed any variant offered as
  an add-on under supplies — including MOTS-C bought on Retatrutide's page.
- Stock moves are unchanged in kind: every included line takes its units out
  of stock and puts them back on cancel or refund like any line.

## The cart

`CartItem.includes` holds a line's included add-ons (`perUnit`, `price`,
`required`, `stock`), and `lineId` (product + include ids) is the line's
identity. Helpers are in `frontend/src/lib/cart-lines.ts`. Old saved carts
(no `lineId`) drop their RM0 lines on load — the server adds the supplies
back at checkout — and keep everything else.

A product card's quick add carries the product's **required** included
add-ons (the product list API returns only those), so the cart can show them;
optional ones are chosen on the product page.
