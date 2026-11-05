# Pre-orders

A sold-out size can still be bought. The units past what is on the shelf are a
**pre-order** and ship when the restock lands; the rest of the order waits for
them and ships together. The checkout, payment and books are exactly the store's
— only what the customer and the team read changes.

## Switches

| Where | What |
|---|---|
| Admin → Store settings → Shipping → **Pre-orders** | `preorder_enabled` (on unless set to `false`) and `preorder_lead_time` (default "10–14 days") |
| Admin → Products → a size → **Pre-order when sold out** | `ProductVariant.preorder` (default on). Off for a size that will not come back |

## How an order records it

- `OrderItem.preorderQty` — units of the line that did **not** come out of stock.
  Stock 2, ordered 5 → 2 taken, `preorderQty` 3. Stock is never driven negative.
- `Order.isPreorder` — any line has `preorderQty > 0`.
- `resolveOrderLines(..., { preorder })` (utils/order-lines.ts) decides the split;
  `stockDemand` only decrements what was taken. `restoreOrderInventory` gives back
  `quantity − preorderQty`, never more than the order took.
- Admin item edits (`adminSetOrderItems`): a line that shrinks drops pre-ordered
  units first; a line that grows takes from stock and pre-orders the shortfall
  when the size allows it, otherwise refuses as before.

## Where it shows

Product page (size card "Pre-order", button "Pre-order", lead-time note), product
cards, JSON-LD (`schema.org/PreOrder`), cart, checkout summary, order emails (boxed
"PRE-ORDER" note + per-line marker), /track, WhatsApp order notice (⏳), admin order
order page badge, Abby's `create_order` preview and her checkout playbook.

## Orders and Pre-orders are separate

Admin → Sales has two tabs over one list (`app/admin/orders/OrdersList.tsx`):
**Orders** (`/admin/orders`) and **Pre-orders** (`/admin/pre-orders`). An order is
in exactly one, by `Order.isPreorder`; a Group Buy order is in Orders. `adminListOrders`
takes `preorder=true|false`, and without it returns both, which is what Payments,
Money and the document picker want. Each pre-order row says how many units are owed
(`Pre-order · 3 of 5 units`).

Because a list no longer shows everything, each tab points at the other: a search
with matches there says "N more in …", proof waiting there gets its own pill, and
`?orderId=` from the Emails page moves to the right tab.

Abby reads the same split: every order she reads carries `orderType`
(`ORDER` / `PRE_ORDER` / `GROUP_BUY`, `orderType()` in utils/preorder.ts), `list_orders`
filters on it and returns `preOrders` (how many of the matches), `get_order` gives each
line's `preorderQty`, and `orders_awaiting_delivery` marks the type. Her checkout
playbook has her report the two apart and never call a waiting pre-order late.

## Restocking

Pre-ordered units are owed to customers already: when the stock arrives, pack the
pre-orders first. They are all on the Pre-orders tab.
