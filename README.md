# ASCEND — Premium Peptides Malaysia

Full-stack e-commerce platform for peptide products. Built with Next.js 16, Fastify 5, Prisma 7, and PostgreSQL.

**Live**: https://ascendpeptides.my

## Tech Stack

- **Frontend**: Next.js 16 (App Router) + Tailwind CSS v4
- **Backend**: Fastify 5 + TypeScript
- **Database**: PostgreSQL + Prisma 7
- **Payments**: Billplz (FPX, eWallets, cards) + WhatsApp manual transfer
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
- Dual checkout: WhatsApp manual transfer + Billplz online payment
- Order tracking by phone number
- Product image uploads with admin management
- Certificate of Analysis (COA) per product with Janoshik verification links
- Trust badges (3rd Party Verified, Free Shipping) on product pages
- "Research use only" disclaimers throughout

### Payment Gateway (Billplz)
- Full Billplz API integration (V3 bills)
- Supports FPX, DuitNow, eWallets (TNG, GrabPay, Boost), cards
- Webhook callback with HMAC-SHA256 X Signature verification (timing-safe)
- Redirect handler with signature verification
- Auto-confirms orders on successful payment (PENDING → CONFIRMED)
- Sandbox/production toggle via `BILLPLZ_SANDBOX` env var
- Fallback: WhatsApp checkout still available for manual bank transfer

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
cp .env.example .env        # edit DATABASE_URL and Billplz keys
npm install
npx prisma migrate dev      # create tables
npx tsx prisma/seed.ts       # seed 21 products, 5 categories, admin user
npm run dev                  # runs on http://localhost:3105
```

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

### Billplz Configuration

```env
BILLPLZ_API_KEY="your-api-secret-key"
BILLPLZ_COLLECTION_ID="your-collection-id"
BILLPLZ_SIGNATURE_KEY="your-x-signature-key"
BILLPLZ_SANDBOX=true          # false for production
```

### Payment Flow

```
Customer → Checkout (Online Payment) → Order created in DB
→ Billplz bill created via API → Customer redirected to Billplz
→ Customer pays (FPX/card/eWallet) → Billplz webhook callback
→ Backend verifies X Signature → Order marked PAID + CONFIRMED
→ Customer redirected to /checkout/success
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
- `POST /api/v1/orders` — create order (returns whatsappUrl or billplzUrl)
- `GET /api/v1/orders/lookup?phone=` — track orders by phone

### Payments

- `POST /api/v1/payments/billplz/callback` — Billplz webhook (X Signature verified)
- `GET /api/v1/payments/billplz/redirect` — Billplz redirect handler

### Admin (requires Bearer token)

- `POST /api/v1/auth/login` — admin login (JWT, 24h expiry)
- `GET /api/v1/auth/me` — current admin user
- `GET /api/v1/admin/dashboard/stats` — dashboard stats
- `GET/POST/PATCH/DELETE /api/v1/admin/products` — product CRUD (featured, COA URL)
- `GET/PATCH /api/v1/admin/orders` — order management
- `GET/PUT /api/v1/admin/settings` — store settings (announcement, WhatsApp, shipping)
- `POST /api/v1/admin/upload/image` — product image upload (JPEG/PNG/WebP, max 5MB)

## Security

- Billplz webhooks verified with HMAC-SHA256 X Signature (timing-safe comparison)
- Order creation fully transactional (no race conditions on stock or order numbers)
- File uploads: type validation, size limit enforced, truncated files deleted
- Rate limiting per-IP (100 req/min)
- CORS origins from environment variable
- JWT auth with 24h expiry on all admin routes
- Helmet security headers
- Input validation via Zod on all endpoints
