# ASCEND — Premium Peptides Malaysia

Full-stack e-commerce platform for peptide products. Built with Next.js 16, Fastify 5, Prisma 7, and PostgreSQL.

**Live**: https://ascendpeptides.my

## Tech Stack

- **Frontend**: Next.js 16 (App Router) + Tailwind CSS v4
- **Backend**: Fastify 5 + TypeScript
- **Database**: PostgreSQL + Prisma 7
- **Payments**: ToyyibPay (live — FPX + cards) with a Billplz adapter, plus WhatsApp manual transfer
- **Deployment**: Nginx + PM2 + Let's Encrypt SSL on Tencent VPS

## Project Structure

```
├── frontend/          Next.js app (port 3000)
├── backend/           Fastify API (port 3105)
└── README.md
```

## Features

### Store
- Product catalog with 5 categories, 21 peptide products
- Featured products (admin toggle) with horizontal scroll showcase
- Shopping cart (localStorage, no login required)
- Dual checkout: WhatsApp manual transfer + online payment (ToyyibPay/Billplz)
- Order tracking by order number + phone
- Product image uploads with admin management
- Certificate of Analysis (COA) per product with Janoshik verification links
- Trust badges (3rd Party Verified, Free Shipping) on product pages
- "Research use only" disclaimers throughout

### Payment Gateway
- **Gateway-agnostic adapter** (`utils/payment-gateway.ts`) — the active gateway
  is chosen by the `payment_gateway` setting in the DB (`toyyibpay` | `billplz`)
- **ToyyibPay** (live): FPX + cards, MD5 callback hash verification, bills expire
  after 1 day
- **Billplz** (adapter ready): FPX/DuitNow/eWallets/cards, HMAC-SHA256 X-Signature
- Callback signatures verified timing-safe; auto-confirms orders on payment
  (UNPAID → PAID, PENDING → CONFIRMED)
- **Idempotent** order creation — a network retry can't double-create or double-charge
- **Reconciliation sweep** (every 10 min) re-queries the gateway for missed
  callbacks and releases stock held by abandoned/never-paid orders
- Amounts stored and charged in **sen** (integer) end-to-end; server is
  authoritative for all pricing (client only sends product IDs + quantities)
- Sandbox/production toggle via `TOYYIBPAY_SANDBOX` / `BILLPLZ_SANDBOX`
- Fallback: WhatsApp checkout for manual bank transfer

### UX
- Scroll-triggered animations (Animate/Stagger components)
- Video strip dividers with lab footage on homepage
- Hero vials jiggle animation on hover/tap
- Floating WhatsApp button on all pages
- Announcement bar (admin-configurable text, toggle on/off)
- Navbar search with expand-from-center animation
- Mobile-responsive with collapsible admin sidebar

### Admin Panel (`/admin`)
- Dashboard with stats, recent orders, low stock alerts
- Product CRUD: images, pricing, stock, featured toggle, COA URL
- Order management: status updates, payment tracking, WhatsApp customer link
- Settings: announcement bar, WhatsApp number, business info, shipping fee

### Content Pages
- `/faq` — 18 questions across 4 categories with accordion UI
- `/guide` — Peptide reconstitution guide, storage table, solvent comparison
- `/shipping` — Shipping policy with delivery times by region
- `/terms` — Terms & conditions
- `/privacy` — Privacy policy
- `/disclaimer` — Research use disclaimer & liability waiver

## SEO

- Dynamic `sitemap.xml` (31+ URLs, auto-generated from product catalog)
- `robots.txt` with crawl rules
- Per-page metadata optimized for Malaysia peptide keywords
- JSON-LD structured data (Organization + Product schemas)
- Open Graph + Twitter Card tags on all pages
- Dynamic `generateMetadata` for product detail pages
- PWA manifest

## Local Development

### Prerequisites

- Node.js 20+
- PostgreSQL (or Docker)

### Backend

```bash
cd backend
cp .env.example .env        # set DATABASE_URL, JWT_SECRET (>=32 chars), gateway keys
npm install                  # postinstall runs `prisma generate`
npx prisma migrate deploy    # apply migrations (single 0_baseline)
npx tsx prisma/seed.ts       # seed 21 products, 5 categories, admin user
npm run dev                  # runs on http://localhost:3105
```

> **Migrations**: history is a single `0_baseline` that matches the schema. To
> change the schema, run `npx prisma migrate dev --name <change>` locally, commit
> the generated migration, and deploy with `npx prisma migrate deploy`. Do **not**
> use `prisma db push` against a tracked environment (it causes drift).

### Frontend

```bash
cd frontend
echo "NEXT_PUBLIC_API_URL=http://localhost:3105" > .env.local
npm install
npm run dev                  # runs on http://localhost:3000
```

### Admin Panel

Navigate to `/admin` and log in:

- **Email**: `admin@ascend.my`
- **Password**: `admin123`

## Payment Gateway Setup

The active gateway is selected by the `payment_gateway` row in the `settings`
table (`toyyibpay` or `billplz`), and online payment is gated by the
`online_payment_enabled` setting.

### Environment

```env
# Core
JWT_SECRET="<openssl rand -hex 32>"   # min 32 chars (enforced)
ADMIN_INITIAL_PASSWORD=""              # required when seeding in production (min 12)

# ToyyibPay (live gateway)
TOYYIBPAY_SECRET_KEY="your-user-secret-key"
TOYYIBPAY_CATEGORY_CODE="your-category-code"
TOYYIBPAY_SANDBOX=false                # "true"/"false" parsed correctly (not coerced)

# Billplz (optional adapter)
BILLPLZ_API_KEY=""
BILLPLZ_COLLECTION_ID=""
BILLPLZ_SIGNATURE_KEY=""
BILLPLZ_SANDBOX=true
```

### Payment Flow

```
Customer → Checkout (Online Payment) → Order created in DB (stock reserved, idempotency key)
→ Gateway bill created via API → Customer redirected to the gateway
→ Customer pays (FPX/card) → gateway server-to-server callback
→ Backend verifies signature → Order marked PAID + CONFIRMED
→ Customer redirected back; redirect handler re-verifies payment server-side
→ Reconcile sweep backstops missed callbacks and releases abandoned orders
```

### WhatsApp Flow

```
Customer → Checkout (WhatsApp) → Order created in DB
→ Formatted message opened in WhatsApp → Customer sends bank transfer
→ Admin confirms payment manually in /admin/orders
```

## Product Categories

| Category                  | Products |
|---------------------------|----------|
| Skin / Anti-Aging / Repair| GHK-Cu, Epithalon, Pinealon, Thymalin |
| Fat Loss / Metabolism     | AOD9604, 5-Amino-1MQ, MOTS-c, Retatrutide |
| Hormone / Muscle Growth   | HGH, IGF-1LR3, Tesamorelin, Tesamorelin+Ipamorelin |
| Immune / Healing          | Thymosin Alpha-1, KPV, PE-22-28 |
| Supplies                  | Acetic Acid |

## Deployment (VPS)

Server: `43.134.16.213` (ubuntu)

```bash
ssh ubuntu@43.134.16.213
cd /home/ubuntu/ascend && git pull

# Backend
cd backend && npm install && npx prisma migrate deploy && pm2 restart ascend-api

# Frontend
cd ../frontend && npm install && npx next build \
  && cp -r public .next/standalone/public \
  && cp -r .next/static .next/standalone/.next/static \
  && pm2 restart ascend-web
```

### PM2 Processes

| Name         | Port | Description       |
|--------------|------|-------------------|
| ascend-api   | 3105 | Fastify backend   |
| ascend-web   | 3000 | Next.js frontend  |

### Nginx

Config at `/etc/nginx/sites-available/ascendpeptides.my` — proxies `/api/*` and `/uploads/*` to backend, everything else to frontend. SSL via Let's Encrypt (auto-renews).

### Database Backups

Daily `pg_dump` at 3am via cron. 14-day retention.

- Backups: `/home/ubuntu/backups/ascend/`
- Logs: `/home/ubuntu/backups/ascend/backup.log`
- Restore: `gunzip -c ascend_YYYYMMDD_HHMMSS.sql.gz | psql -U ascend_user ascend`

## API Endpoints

### Public

- `GET /api/v1/categories` — list categories
- `GET /api/v1/products?category=&search=&featured=true` — list products
- `GET /api/v1/products/:slug` — product detail
- `GET /api/v1/settings` — public store settings
- `POST /api/v1/orders` — create order (returns `whatsappUrl` or `paymentUrl`; accepts `idempotencyKey`)
- `GET /api/v1/orders/lookup?phone=&orderNumber=` — track an order (both fields required; returns no PII)
- `POST /api/v1/orders/validate-discount` — preview a discount code

### Payments

- `POST /api/v1/payments/callback` — gateway webhook, ToyyibPay + Billplz (signature verified)
- `GET /api/v1/payments/redirect` — return handler (re-verifies payment server-side)

### Admin (requires Bearer token)

- `POST /api/v1/auth/login` — admin login (JWT, 24h expiry)
- `GET /api/v1/auth/me` — current admin user
- `GET /api/v1/admin/dashboard/stats` — dashboard stats
- `GET/POST/PATCH/DELETE /api/v1/admin/products` — product CRUD (featured, COA URL)
- `GET/PATCH /api/v1/admin/orders` — order management
- `GET/PUT /api/v1/admin/settings` — store settings (announcement, WhatsApp, shipping)
- `POST /api/v1/admin/upload/image` — product image upload (JPEG/PNG/WebP/AVIF, max 5MB, magic-byte validated)

## Security

- **Payment webhooks** verified with the gateway signature (ToyyibPay MD5,
  Billplz HMAC-SHA256), timing-safe; payment is re-verified server-side on return
- **Server-authoritative pricing** — the client only sends product IDs +
  quantities; subtotal, shipping, discount, and total are computed from the DB
- **Concurrency-safe** — atomic conditional stock decrement (no oversell) and
  atomic discount-use reservation (can't exceed `maxUses`); idempotent order
  creation prevents double-charge on retries; single, idempotent, floored
  inventory restore (no double-restore / negative usage)
- **Order lookup** requires order number + phone and returns no PII (no
  enumeration); per-route rate limits (login 5/min, lookup 10/min, discount
  15/min, order create 20/min, callback 300/min) on top of the global 100/min
- **JWT** with HS256 pinned (sign + verify), 24h expiry, secret min 32 chars;
  all admin routes authenticated
- **File uploads** validated by real magic bytes (not the client MIME), random
  UUID filenames, size-limited; `/uploads` served with a locked-down CSP + nosniff
- Boolean/numeric env vars parsed safely (no `Boolean("false") === true` traps);
  numeric settings validated server-side
- CORS origins from environment; Helmet security headers; Zod validation on all
  endpoints; `prisma generate` runs on install so a stale client can't ship
