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
# The Prisma CLI does not read backend/.env — only the running app does, via
# config/env.ts — so this used to fail with "no DATABASE_URL" on every deploy.
# It was wrapped in `|| echo WARN`, which meant the deploy sailed on and
# restarted the new code against an UNMIGRATED database. That is not a warning,
# it is an outage waiting for the first request that touches a new column, and
# it happened on 2026-08-13 (the crypto + payment-failure deploy). Export the
# app's own DATABASE_URL, and abort if migrating fails.
#
# Aborting here is safe by design: nothing has been rebuilt or restarted yet, so
# a failed migration leaves the old code running against the old schema —
# a consistent state — rather than new code against an old schema.
set -a; DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | tr -d '"')"; set +a
if [ -z "$DATABASE_URL" ]; then
  echo "FATAL: no DATABASE_URL in backend/.env — cannot migrate. Aborting before anything is rebuilt or restarted."
  exit 1
fi
export DATABASE_URL
npx prisma migrate deploy
# migrate deploy does NOT regenerate the client (a known trap on this project),
# and npm install's postinstall generate ran BEFORE the migration above. The
# client is built from schema.prisma rather than the live DB so the ordering is
# usually harmless, but regenerating here costs seconds and removes the doubt.
npx prisma generate
npm run build

cd ../frontend
npm install --no-audit --no-fund
# The running standalone server writes its own caches into
# .next/standalone/.next/cache (fetch-cache, and the image optimiser's output).
# `next build` cleans .next first, walks into that nested copy, and dies with
# ENOTEMPTY because the live process is still writing there — the build then
# aborts having ALREADY part-cleaned .next, so the server it left running is
# serving from a half-deleted directory. That is not a failed deploy, it is an
# outage: it took /products and /checkout to 500 on 2026-08-13 while / stayed
# 200, so it does not even look broken from the front page.
#
# Removing the nested cache before the build is enough. It is pure cache — the
# optimiser refills it on the first request for each image.
rm -rf .next/standalone/.next/cache
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

# Ports are pinned explicitly on every restart. `--update-env` re-reads the
# CALLING shell's environment, and any deploy step that sources backend/.env
# exports PORT=3105 — which then gets handed to the FRONTEND, producing
# EADDRINUSE on 3105, a dead ascend-web, and a 502 on the whole site. That
# happened on 2026-07-31. Naming the port here makes the shell's value
# irrelevant no matter how this script is invoked.
PORT=3105 pm2 restart ascend-api --update-env
PORT=3000 pm2 restart ascend-web --update-env

# The WhatsApp agent worker holds the baileys socket. Restarting it drops the
# connection briefly; the saved session means it reconnects without a re-scan.
# `|| true` because a first deploy has no such process yet — see
# docs/whatsapp-agent.md for the one-time pm2 start command.
PORT=3105 pm2 restart ascend-wa --update-env || echo "NOTE: ascend-wa not running — see docs/whatsapp-agent.md to start it the first time"

pm2 ls | grep ascend

# PM2 reporting "online" says nothing about whether the ports are actually
# bound — a crash-looping process shows green between restarts. Check the
# sockets, which is what the 2026-07-31 outage needed and didn't have.
echo "--- listening ports (expect 3000 web, 3105 api, 3107 worker control plane) ---"
ss -lntp 2>/dev/null | grep -E ":(3000|3105|3107)" || echo "WARN: expected ports are not all listening"
