#!/bin/sh
# Abby's browser: one headless Chromium with CDP on 127.0.0.1:9222.
# Started by abby-browser.service on the VPS (as the abby-browser user, after
# firewall.sh), or by backend/scripts/browser-local.sh on a laptop with
# CHROME and ABBY_BROWSER_HOME set. See docs/assistant.md, "The browser".
set -eu

HOME_DIR="${ABBY_BROWSER_HOME:-/var/lib/abby-browser}"
PORT="${ABBY_BROWSER_PORT:-9222}"

if [ -z "${CHROME:-}" ]; then
  # Playwright's Chromium build, installed by install.sh. The newest wins.
  CHROME="$(ls -d /opt/abby-browser/browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -1)"
fi
[ -x "$CHROME" ] || { echo "no Chromium at '${CHROME}'" >&2; exit 1; }

# A clean profile every start: no cookies, no history, no saved sign-ins.
# A login the operator makes through the live view lasts until the browser
# next sleeps, and no longer.
rm -rf "$HOME_DIR/profile"
mkdir -p "$HOME_DIR/profile"

# Memory: the cap is 600 MB. Site isolation gives every cross-site frame (each
# ad, each embed) its own renderer, and a news page with a dozen of them broke
# the cap on 20 Oct 2026 — the kernel killed the tab mid-read. One profile with
# no sign-ins has no cross-site secrets for isolation to protect, so it is off,
# renderers are limited to two, and each one's script heap to 256 MB.

# Headless Chromium says "HeadlessChrome" in its user agent, which a good part
# of the web answers with a block page. Present as the desktop Chrome it is.
MAJOR="$("$CHROME" --version 2>/dev/null | grep -oE '[0-9]+\.' | head -1 | tr -d .)"
case "$(uname)" in
  Darwin) PLATFORM='Macintosh; Intel Mac OS X 10_15_7' ;;
  *) PLATFORM='X11; Linux x86_64' ;;
esac
UA="Mozilla/5.0 ($PLATFORM) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MAJOR:-140}.0.0.0 Safari/537.36"

export TZ=Asia/Kuala_Lumpur

exec "$CHROME" \
  --headless=new \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$HOME_DIR/profile" \
  --window-size=1280,800 \
  --user-agent="$UA" \
  --lang=en-MY \
  --accept-lang=en-MY,en-GB,en,ms \
  --no-first-run \
  --no-default-browser-check \
  --disable-sync \
  --disable-dev-shm-usage \
  --disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication,IsolateOrigins,site-per-process \
  --password-store=basic \
  --use-mock-keychain \
  --renderer-process-limit=2 \
  --disable-site-isolation-trials \
  --js-flags=--max-old-space-size=256 \
  --disk-cache-size=33554432 \
  --media-cache-size=8388608 \
  --mute-audio \
  about:blank
