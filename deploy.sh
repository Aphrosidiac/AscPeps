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
echo "--- listening ports (expect 3000 web, 3105 api, 3106 worker control plane) ---"
ss -lntp 2>/dev/null | grep -E ":(3000|3105|3106)" || echo "WARN: expected ports are not all listening"
