#!/bin/bash
# Ascend deploy — pull, build, restart. Next runs in standalone mode, so
# public/ and .next/static MUST be re-copied into .next/standalone after
# every build or public assets and JS chunks 404.
set -euo pipefail
cd /home/ubuntu/ascend

# npm install on the server regenerates package-lock.json lockfile metadata
# (platform-specific optional-dep entries etc.) even when nothing dependency-
# wise changed — that self-inflicted local diff then blocks the next pull.
# It is always safe to discard: the upcoming npm install regenerates it fresh
# either way.
git checkout -- backend/package-lock.json frontend/package-lock.json 2>/dev/null || true
git pull --ff-only

cd backend
npm install --no-audit --no-fund
npx prisma migrate deploy || echo "WARN: migrate deploy failed (no DATABASE_URL for CLI) — apply pending migrations manually via psql"
npm run build

cd ../frontend
npm install --no-audit --no-fund
npm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
# ...and .env too. server.js does process.chdir(__dirname), so the running app
# reads .next/standalone/.env — NOT frontend/.env. A hand-maintained copy here
# silently drifted once already: it held only the NEXT_PUBLIC_POSTHOG_* vars, so
# REVALIDATE_SECRET was undefined and /api/revalidate 401'd every admin-save ping.
# Nothing errors when that happens; the storefront just quietly falls back to its
# 1-hour cache, so an admin save looks like it did nothing for up to an hour.
cp .env .next/standalone/.env

pm2 restart ascend-api ascend-web --update-env
pm2 ls | grep ascend
