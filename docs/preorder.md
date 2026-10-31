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
list and order page badges, Abby's `create_order` preview and her checkout playbook.

## Restocking

Pre-ordered units are owed to customers already: when the stock arrives, pack the
pre-orders first. Orders list badge "Pre-order" finds them.
