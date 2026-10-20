#!/bin/sh
# Abby's browser on a laptop: the same launcher the VPS uses, with the local
# Google Chrome. Point the API at it with, in backend/.env:
#
#   AGENT_BROWSER=on
#   BROWSER_START_CMD=sh scripts/browser-local.sh start
#   BROWSER_STOP_CMD=sh scripts/browser-local.sh stop
#
# No firewall here — on a laptop the browser can reach localhost like any
# other program. The VPS unit is what keeps it off the store's internals.
set -eu
cd "$(dirname "$0")/.."
STATE="${TMPDIR:-/tmp}/abby-browser"
mkdir -p "$STATE"

case "${1:-}" in
  start)
    if [ -f "$STATE/pid" ] && kill -0 "$(cat "$STATE/pid")" 2>/dev/null; then exit 0; fi
    CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}" \
      ABBY_BROWSER_HOME="$STATE" \
      nohup sh ../ops/abby-browser/launch.sh >"$STATE/log" 2>&1 &
    echo $! >"$STATE/pid"
    ;;
  stop)
    if [ -f "$STATE/pid" ]; then
      kill "$(cat "$STATE/pid")" 2>/dev/null || true
      rm -f "$STATE/pid"
    fi
    ;;
  *)
    echo "usage: $0 start|stop" >&2
    exit 2
    ;;
esac
