# ASCEND — Premium Peptides Malaysia

Full-stack e-commerce platform for peptide products. Built with Next.js 16, Fastify 5, Prisma 7, and PostgreSQL.

**Live**: https://ascend.apdevotion.my

## Tech Stack

- **Frontend**: Next.js 16 (App Router) + Tailwind CSS v4
- **Backend**: Fastify 5 + TypeScript
- **Database**: PostgreSQL + Prisma 7
- **Deployment**: Nginx + PM2 + Let's Encrypt SSL on Tencent VPS

## Project Structure

```
├── frontend/          Next.js app (port 3000)
├── backend/           Fastify API (port 3105)
└── README.md
```

## Local Development

### Prerequisites

- Node.js 20+
- PostgreSQL (or Docker)

### Backend

```bash
cd backend
cp .env.example .env        # edit DATABASE_URL with your PG credentials
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

Config at `/etc/nginx/sites-available/ascend.apdevotion.my` — proxies `/api/*` to backend, everything else to frontend. SSL via Let's Encrypt (auto-renews).

## API Endpoints

### Public

- `GET /api/v1/categories` — list categories
- `GET /api/v1/products?category=&search=` — list products
- `GET /api/v1/products/:slug` — product detail
- `POST /api/v1/orders` — create order
- `GET /api/v1/orders/lookup?phone=` — track orders by phone

### Admin (requires Bearer token)

- `POST /api/v1/auth/login` — admin login
- `GET /api/v1/admin/dashboard/stats` — dashboard stats
- `GET/POST/PATCH/DELETE /api/v1/admin/products` — product CRUD
- `GET/PATCH /api/v1/admin/orders` — order management
- `GET/PUT /api/v1/admin/settings` — store settings
