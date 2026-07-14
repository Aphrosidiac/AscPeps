<div align="center">

# ASCEND — Research Peptides Malaysia

**Full-stack e-commerce platform for research-grade peptides**, built on Next.js 16 + Fastify 5 + Prisma 7 + PostgreSQL, with a two-gateway payment layer, a research-literature-backed product catalog, and an SEO/GEO posture built for both search engines and AI answer engines.

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev)
[![Fastify](https://img.shields.io/badge/Fastify-5-000000?logo=fastify)](https://fastify.dev)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-blue?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Tailwind](https://img.shields.io/badge/Tailwind_CSS-4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)

**Live:** [ascendpeptides.my](https://ascendpeptides.my)

</div>

---

## Contents

- [Overview](#overview)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Features](#features)
- [Product catalog](#product-catalog)
- [Content & compliance governance](#content--compliance-governance)
- [SEO & GEO](#seo--geo)
- [Local development](#local-development)
- [Environment variables](#environment-variables)
- [Payment gateway](#payment-gateway)
- [Deployment](#deployment-vps)
- [API reference](#api-reference)
- [Security](#security)

---

## Overview

ASCEND is a Malaysian e-commerce storefront for laboratory research peptides — every product is sold strictly for research and laboratory use, with compliance-conscious copy throughout (no medical claims, honest disclosure of mixed/negative trial results, explicit "for research use only" framing on every page). The catalog spans 54 active SKUs across 10 categories, backed by real PubMed/PMC-cited research content for the large majority of products.

The site is built to be legible to three audiences at once: human shoppers (fast, mobile-first, WhatsApp-native checkout), search engines (fully server-rendered, rich Schema.org structured data, a clean sitemap), and AI answer engines (a maintained `llms.txt`, IndexNow pings on every catalog change, citation-dense product copy).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router, Turbopack, standalone output) · React 19 · Tailwind CSS v4 |
| Backend | Fastify 5 · TypeScript · Zod validation |
| Database | PostgreSQL · Prisma 7 (driver-adapter pattern, `@prisma/adapter-pg`) |
| Payments | ToyyibPay (live: FPX + cards) · Billplz (adapter ready) · WhatsApp manual transfer |
| Infra | Nginx · PM2 · Let's Encrypt (Certbot) · Brotli + gzip compression |

## Project structure

```
AscPeps/
├── frontend/                Next.js app — port 3000
│   ├── src/app/              App Router pages (products, guide, coa, calculator, admin…)
│   ├── src/components/       ProductCard, ProductRail, JsonLd, guide/, ui/
│   └── src/lib/               server-api.ts, product-relations.ts, utils.ts
├── backend/                 Fastify API — port 3105
│   ├── src/modules/          products, orders, payments, admin, auth
│   ├── src/utils/            payment-gateway.ts, indexnow.ts, order-inventory.ts
│   ├── scripts/               one-off/maintenance scripts (content backfills, etc.)
│   └── prisma/                schema.prisma, single 0_baseline migration
└── README.md
```

## Features

### Store
- 54-product catalog across 10 categories, fully server-rendered (no client-side catalog bailout)
- Featured products carousel, category filtering, search — all crawlable, bookmarkable URLs
- "Available Sizes" cross-links between dosage variants of the same compound, "Related Products," and a "Frequently Paired With" cross-sell module (BAC water / Acetic Acid, category-aware)
- A "How to Reconstitute" section merged onto product pages from the `/guide` content, gated to only appear where relevant (not shown on ready-to-use liquid products)
- Shopping cart (localStorage, no login required) with a mobile sticky Add-to-Cart bar
- Dual checkout: WhatsApp manual transfer + online payment (ToyyibPay/Billplz)
- Order tracking by order number + phone (no PII exposed)
- Certificate of Analysis per product, plus a dedicated `/coa` page explaining third-party testing methodology
- Interactive reconstitution/dose calculator (`/calculator`)

### Payment Gateway
- **Gateway-agnostic adapter** (`utils/payment-gateway.ts`) — the active gateway is chosen by the `payment_gateway` setting in the DB (`toyyibpay` | `billplz`)
- **ToyyibPay** (live): FPX + cards, MD5 callback hash verification, bills expire after 1 day
- **Billplz** (adapter ready): FPX/DuitNow/eWallets/cards, HMAC-SHA256 X-Signature
- Callback signatures verified timing-safe; auto-confirms orders on payment (UNPAID → PAID, PENDING → CONFIRMED)
- **Idempotent** order creation — a network retry can't double-create or double-charge
- **Reconciliation sweep** (every 10 min) re-queries the gateway for missed callbacks and releases stock held by abandoned/never-paid orders
- Amounts stored and charged in **sen** (integer) end-to-end; server is authoritative for all pricing
- Sandbox/production toggle via `TOYYIBPAY_SANDBOX` / `BILLPLZ_SANDBOX`

### Admin Panel (`/admin`)
- Dashboard with stats, recent orders, low stock alerts
- Product CRUD: images, pricing, stock, featured toggle, COA URL, benefits/dosage content
- Order management: status updates, payment tracking, WhatsApp customer link
- Settings: announcement bar, WhatsApp number, business info, shipping fee

### Content Pages
- `/faq` — 12 real questions across purity, COA, ordering, payment, shipping
- `/guide` — reconstitution steps, storage guidelines, solvent comparison table
- `/calculator` — interactive BAC water / concentration calculator
- `/coa` — Certificates of Analysis and third-party testing methodology
- `/shipping`, `/terms`, `/privacy`, `/disclaimer` — legal & policy pages

## Product catalog

54 active products across 10 categories:

| Category | SKUs | Examples |
|---|---|---|
| Immune / Healing | 9 | BPC-157, TB-500, KPV, Thymosin Alpha-1 |
| Fat Loss / Metabolism | 8 | Retatrutide, MOTS-c, AOD9604, 5-Amino-1MQ |
| Hormone / Muscle Growth | 7 | Tesamorelin, Ipamorelin, CJC-1295, HGH, IGF-1LR3 |
| Mitochondrial / Longevity | 7 | NAD+, SS-31 (Elamipretide), Humanin, FOXO4-DRI |
| Skin / Anti-Aging / Repair | 6 | GHK-Cu, Epitalon, Thymalin, Pinealon |
| Health Boosters (Injectables) | 6 | Vitamin C, Glutathione, PDRN, Ginkgo Biloba, Alpha Lipoic Acid |
| Brain / Nootropic | 5 | Selank, Semax, DSIP, P021, Cerebrolysin |
| Supplies | 3 | Bacteriostatic Water, Acetic Acid |
| Testosterone | 2 | Testosterone Enanthate, Sustanon-style blend |
| Joint / Tissue / Specialty | 1 | PE-22-28 |

## Content & compliance governance

Product copy follows a strict pattern: a research-context paragraph citing real, verifiable PubMed/PMC studies, an honest note when a product's vial-size tiers aren't themselves a studied dose-response variable, and standard reconstitution/storage instructions — framed throughout as "studied for" / "researched for," never a human-use or efficacy claim. Where evidence is thin, mixed, or contradictory (e.g. a peptide with only small, geographically narrow trial data, or a compound with a discontinued/mixed clinical trial history), the copy says so explicitly rather than overselling it.

**A small number of products intentionally carry no content**, pending an actual legal/regulatory review rather than a copywriting decision — this applies to compounds that are the active ingredient of an approved prescription drug, or that fall under Malaysia's Poisons Act, or that appear on Malaysia's NPRA Negative List. This is a deliberate, documented hold, not a content gap to be filled in.

No product page carries a review/rating unless real customer reviews exist — placeholder ratings are never fabricated.

## SEO & GEO

- Every route is server-rendered — no client-side catalog bailout, real HTML for every crawler regardless of JavaScript execution
- Rich Schema.org JSON-LD: `Organization`, `WebSite`+`SearchAction`, `Product` (with `Offer`, `hasMerchantReturnPolicy`, `shippingDetails`, `priceValidUntil`, `dateModified`), `BreadcrumbList`, `CollectionPage`/`ItemList`, `FAQPage`
- Dynamic `sitemap.xml` (65 URLs) with real per-record `lastmod` dates — static pages from git history, product pages from the DB's `updatedAt`
- `/llms.txt` — a maintained, auto-generated source-of-truth file for AI crawlers (brand summary, key pages, live per-product pricing)
- **IndexNow** — the backend pings Bing/Yandex/Naver on every product create/update/deactivate, fire-and-forget
- CSP + Permissions-Policy headers, Brotli compression, HSTS, canonical/trailing-slash normalization
- All AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) explicitly welcomed in `robots.txt`

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
npx tsx prisma/seed.ts       # seed categories, products, admin user
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

Navigate to `/admin` and log in with the credentials from your seeded/production admin user.

## Environment variables

```env
# Core
DATABASE_URL="postgresql://user:pass@localhost:5432/ascend"
JWT_SECRET="<openssl rand -hex 32>"   # min 32 chars (enforced)
ADMIN_INITIAL_PASSWORD=""              # required when seeding in production (min 12)
PORT=3105
HOST="0.0.0.0"
FRONTEND_URL="http://localhost:3000"
CORS_ORIGINS="https://ascendpeptides.my"
WHATSAPP_NUMBER="601161092723"

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

Frontend needs `NEXT_PUBLIC_API_URL` pointing at the backend (also used server-side by `next.config.ts`'s `/uploads` rewrite — see [Deployment](#deployment-vps)).

## Payment Gateway

The active gateway is selected by the `payment_gateway` row in the `settings` table (`toyyibpay` or `billplz`), and online payment is gated by the `online_payment_enabled` setting.

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

## Deployment (VPS)

Server: `43.134.16.213` (ubuntu)

```bash
ssh ubuntu@43.134.16.213
cd /home/ubuntu/ascend && git pull origin main

# Backend (runs unbundled via tsx — no build step)
cd backend
npm install
npx prisma migrate deploy
pm2 restart ascend-api

# Frontend (standalone output needs public/ and .next/static/ copied in manually)
cd ../frontend
npm install
npx next build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
pm2 restart ascend-web
```

> **DB scripts over SSH:** a plain `ssh host "npx prisma migrate deploy"` picks up a placeholder `DATABASE_URL` and fails auth — env vars aren't auto-sourced in a non-interactive SSH shell. Explicitly load them first: `set -a && source .env && set +a && npx prisma migrate deploy`.

### PM2 Processes

| Name | Port | Description |
|---|---|---|
| `ascend-api` | 3105 | Fastify backend, runs via `npx tsx src/server.ts` (no build step) |
| `ascend-web` | 3000 | Next.js frontend, standalone output |

### Nginx

Config at `/etc/nginx/sites-available/ascendpeptides.my` — proxies `/api/*` and `/uploads/*` to the backend, everything else to the frontend. SSL via Let's Encrypt (auto-renews). CSP, Permissions-Policy, and Brotli are configured at this layer.

> **`next/image` + `/uploads`:** Next's image optimizer resolves a relative `src` by fetching it from the Next.js server *itself*, not through nginx — but `/uploads/*` is only ever served by the backend. `next.config.ts` has a `rewrites()` proxy (`/uploads/:path* → backend`) specifically so this internal fetch resolves correctly; removing it will silently break every product photo.

### Database Backups

Daily `pg_dump` at 3am via cron. 14-day retention.

- Backups: `/home/ubuntu/backups/ascend/`
- Logs: `/home/ubuntu/backups/ascend/backup.log`
- Restore: `gunzip -c ascend_YYYYMMDD_HHMMSS.sql.gz | psql -U ascend_user ascend`

## API Reference

### Public

- `GET /api/v1/categories` — list categories
- `GET /api/v1/products?category=&search=&featured=true&limit=` — list products
- `GET /api/v1/products/:slug` — product detail
- `GET /api/v1/settings` — public store settings
- `POST /api/v1/orders` — create order (returns `whatsappUrl` or `paymentUrl`; accepts `idempotencyKey`)
- `GET /api/v1/orders/lookup?phone=&orderNumber=` — track an order (both fields required; returns no PII)
- `POST /api/v1/orders/validate-discount` — preview a discount code
- `GET /health` — process liveness check

### Payments

- `POST /api/v1/payments/callback` — gateway webhook, ToyyibPay + Billplz (signature verified)
- `GET /api/v1/payments/redirect` — return handler (re-verifies payment server-side)

### Admin (requires Bearer token)

- `POST /api/v1/auth/login` — admin login (JWT, 24h expiry)
- `GET /api/v1/auth/me` — current admin user
- `GET /api/v1/admin/dashboard/stats` — dashboard stats
- `GET/POST/PATCH/DELETE /api/v1/admin/products` — product CRUD (featured, COA URL) — pings IndexNow on every mutation
- `GET/PATCH /api/v1/admin/orders` — order management
- `GET/PUT /api/v1/admin/settings` — store settings (announcement, WhatsApp, shipping)
- `POST /api/v1/admin/upload/image` — product image upload (JPEG/PNG/WebP/AVIF, max 5MB, magic-byte validated)

## Security

- **Payment webhooks** verified with the gateway signature (ToyyibPay MD5, Billplz HMAC-SHA256), timing-safe; payment is re-verified server-side on return
- **Server-authoritative pricing** — the client only sends product IDs + quantities; subtotal, shipping, discount, and total are computed from the DB
- **Concurrency-safe** — atomic conditional stock decrement (no oversell) and atomic discount-use reservation (can't exceed `maxUses`); idempotent order creation prevents double-charge on retries; single, idempotent, floored inventory restore (no double-restore / negative usage)
- **Order lookup** requires order number + phone and returns no PII (no enumeration); per-route rate limits (login 5/min, lookup 10/min, discount 15/min, order create 20/min, callback 300/min) on top of the global 100/min
- **JWT** with HS256 pinned (sign + verify), 24h expiry, secret min 32 chars; all admin routes authenticated
- **File uploads** validated by real magic bytes (not the client MIME), random UUID filenames, size-limited; `/uploads` served with a locked-down CSP + nosniff
- **`trustProxy: true`** on the Fastify instance so per-IP rate limiting actually keys on the real client IP behind nginx, not nginx's own loopback address
- Boolean/numeric env vars parsed safely (no `Boolean("false") === true` traps); numeric settings validated server-side
- CORS origins from environment; Helmet security headers; Zod validation on all endpoints; `prisma generate` runs on install so a stale client can't ship
