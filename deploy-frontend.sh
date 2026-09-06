#!/bin/bash
# Build the frontend LOCALLY and ship the output. Use this instead of the
# `npm run build` inside deploy.sh whenever the server is short of memory —
# ascend-vps has ~300MB free and 1.3GB of its swap already used, and a build
# that OOMs there leaves .next half-cleaned while ascend-web is still serving
# from it (see the 2026-08-13 note in deploy.sh).
#
# THE TRAP THIS SCRIPT EXISTS TO PREVENT
#
# NEXT_PUBLIC_* variables are inlined into the client bundle at BUILD time, not
# read at runtime. frontend/.env.local sets NEXT_PUBLIC_API_URL=http://localhost:3105
# for local development. Building on a laptop with that file in place bakes
# "localhost:3105" into every client bundle, and the server's own .env cannot
# override it — so every browser on the internet then tries to call the API on
# its OWN machine. That is a total outage of the storefront and admin, and it
# looks fine from curl because server-rendered HTML still returns 200.
#
# It happened on 2026-09-06. The two guards below are why it cannot happen
# silently again: .env.local is moved aside for the build, and the built output
# is refused if "localhost" appears anywhere in it.
set -euo pipefail

cd "$(dirname "$0")/frontend"
REMOTE=${REMOTE:-ascend-vps}
REMOTE_DIR=${REMOTE_DIR:-/home/ubuntu/ascend/frontend}

restore() { [ -f .env.local.deploybak ] && mv .env.local.deploybak .env.local; }
trap restore EXIT

[ -f .env.local ] && mv .env.local .env.local.deploybak && echo "→ .env.local set aside for the build"

# The running standalone server writes caches into this nested copy; `next build`
# cleans .next, walks into it and dies with ENOTEMPTY, having already part-cleaned.
rm -rf .next/standalone/.next/cache
npm run build

echo "→ checking the CLIENT bundle for a local API URL"
# .next/static only — the client bundles, which run in a visitor's browser and
# must therefore never name localhost.
#
# Deliberately NOT the whole of .next/standalone: the server output legitimately
# contains localhost:3105, because src/lib/server-api.ts falls back to it for
# server-side fetches, and the Next server really does reach the API that way on
# the same box. Grepping the whole tree flags every correct build.
if grep -rq "localhost:3105" .next/static 2>/dev/null; then
  echo "REFUSING TO DEPLOY: localhost:3105 is baked into the CLIENT bundle."
  echo "Something set NEXT_PUBLIC_API_URL at build time. Production expects it UNSET"
  echo "so the client uses same-origin relative URLs through nginx."
  exit 1
fi
echo "  clean"

echo "→ shipping"
# --exclude .env: the standalone server reads .next/standalone/.env, which is
# maintained on the server. Overwriting it from a laptop has already broken
# REVALIDATE_SECRET once (see deploy.sh).
rsync -az --delete --exclude '.env' --exclude '.next/cache' .next/standalone/ "$REMOTE:$REMOTE_DIR/.next/standalone/"
rsync -az --delete .next/static/ "$REMOTE:$REMOTE_DIR/.next/standalone/.next/static/"
rsync -az --delete public/ "$REMOTE:$REMOTE_DIR/.next/standalone/public/"
rsync -az .next/BUILD_ID "$REMOTE:$REMOTE_DIR/.next/BUILD_ID"

ssh "$REMOTE" 'PORT=3000 pm2 restart ascend-web --update-env >/dev/null 2>&1'
sleep 8

echo "→ verifying the LIVE page, not just the HTTP status"
# A server-rendered page returns 200 even when every client-side call is broken,
# which is exactly how the outage was missed. Check the shipped JS instead.
if ssh "$REMOTE" "grep -rq 'localhost:3105' $REMOTE_DIR/.next/standalone/.next/static 2>/dev/null"; then
  echo "FAILED: localhost is present in the deployed bundle."
  exit 1
fi
for p in / /products /admin/dashboard; do
  printf '  %-20s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "https://ascendpeptides.my$p")"
done
echo "done"
