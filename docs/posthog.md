# PostHog analytics

Answers the two questions GA4 and GoAccess can't: **which products actually
convert**, and **where checkout leaks**.

## Design decisions

**Revenue is server-side only.** The browser never emits a `purchase`. It emits
`checkout_submitted` when the order row is created, which for online payment is
before the customer has even reached the gateway — orders are abandoned there
routinely (`reconcileStaleOrders` exists to restock them). `purchase`, with the
revenue on it, is emitted from the backend at the two points where an order
genuinely becomes PAID:

| Path | Where | Covers |
|---|---|---|
| Gateway | `applyPaid()` in `backend/src/utils/payment-reconcile.ts` | ToyyibPay/Billplz callback, redirect verify, reconcile sweep |
| Manual | `adminUpdateOrder()` in `backend/src/modules/admin/admin-orders.controller.ts` | WhatsApp + manual transfer, marked Paid by an admin |

Both sit behind guarded `UNPAID -> PAID` transitions, so duplicate callbacks
and repeated sweeps cannot double-count revenue.

**How the funnel joins up.** The server event's `distinct_id` is
`order_<orderNumber>` — never the customer's email or phone. At checkout the
browser calls `posthog.alias('order_<orderNumber>')`, which merges that id onto
the person who actually browsed. Full funnel, no PII, no new DB column.

This is why `person_profiles` is `"always"` in `instrumentation-client.ts`.
Switching it to `"identified_only"` disables the person processing `alias`
depends on and silently breaks every funnel at the purchase step.

**Privacy.** Session replay is disabled in code, not left to the project's UI
toggle — that toggle applies to the already-deployed script, so without the
explicit `disable_session_recording: true` someone could start recording the
checkout form from the dashboard with no code change and no review. Checkout
collects name, phone, address and email. `mask_personal_data_properties` is on,
and a `before_send` hook strips URLs and referrers on `/checkout` and `/track`
and drops `/admin` events outright — staff clicks never reach PostHog, so
internal activity can't pollute the storefront funnels and no order PII shown
in the admin UI is ever transmitted.

That admin filter is deliberately `before_send` and not `opt_out_capturing()`:
the latter persists to localStorage, so closing the browser on an admin page
would leave that browser permanently opted out of storefront analytics.

## Setup

The live project is **531983, on US Cloud**. Everything below is pinned to
that region. A token/host region mismatch does not raise an error — it
silently drops every event — so if the project is ever recreated in the EU,
change the two `*_POSTHOG_HOST` values, their two code defaults, and the
nginx block together.

1. Copy the project token from PostHog > Settings > Project.
2. Frontend — `frontend/.env` on the VPS:
   ```
   NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=phc_xxx
   NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
   NEXT_PUBLIC_POSTHOG_PROXY=/ingest
   ```
   These are inlined at build time — a rebuild is required, a restart is not
   enough.
3. Backend — `backend/.env` on the VPS:
   ```
   POSTHOG_API_KEY=phc_xxx
   POSTHOG_HOST=https://us.i.posthog.com
   POSTHOG_ENABLED=true
   ```
4. Add the nginx proxy below, then `sudo nginx -t && sudo systemctl reload nginx`.

Leaving the token unset disables analytics everywhere and the site behaves
exactly as before.

## nginx proxy

Keeps ingestion on `ascendpeptides.my` so tracker blockers don't eat the data.
Deliberately nginx and not a Next.js rewrite: nginx already fronts every
request, whereas proxying through Next would put analytics traffic through a
Node process on a memory-tight box, and would require
`skipTrailingSlashRedirect: true` — a global URL-canonicalisation change
affecting every route on a site with 57 SEO redirects.

Add inside the `ascendpeptides.my` server block, **above** the `location /`
block:

```nginx
# PostHog ingestion proxy. US region, matching project 531983 — change both
# hosts here together with the two *_POSTHOG_HOST env vars if the project
# region ever changes.
location /ingest/static/ {
    proxy_pass https://us-assets.i.posthog.com/static/;
    proxy_set_header Host us-assets.i.posthog.com;
    proxy_ssl_server_name on;
    access_log off;
}

location /ingest/ {
    proxy_pass https://us.i.posthog.com/;
    proxy_set_header Host us.i.posthog.com;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_ssl_server_name on;
    access_log off;
}
```

`access_log off` on both keeps analytics traffic out of
`/var/log/nginx/ascend_access.log`, which GoAccess parses — without it the
GoAccess dashboard would count every event as a pageview.

## Events

| Event | Fired from | Notes |
|---|---|---|
| `product_variant_selected` | product page | size carousel |
| `add_to_cart` | product page | includes add-on count |
| `remove_from_cart` | cart | |
| `checkout_started` | cart | "Proceed to Checkout" |
| `payment_method_selected` | checkout | WhatsApp vs online |
| `discount_applied` | checkout | |
| `checkout_submitted` | checkout | order created — **not** paid, no revenue |
| `purchase` | **backend** | payment confirmed; carries `revenue` (MYR) |
| `checkout_payment_failed` | checkout/failed | |
| `order_tracked` | /track | |
| `calculator_used` | /calculator | once per visit, when a result first shows |

Suggested funnel: `add_to_cart` → `checkout_started` → `checkout_submitted` →
`purchase`. The gap between the last two is abandoned payment.
