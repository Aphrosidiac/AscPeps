#!/bin/sh
# Proves the browser's fence on the VPS: it starts, CDP answers, the sandbox is
# on, and as the abby-browser user the internet is reachable while localhost,
# the private ranges and this box's own address are not. Leaves it stopped.
#
#   sh ops/abby-browser/check.sh
set -u
PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok  $1"; }
no() { FAIL=$((FAIL + 1)); echo "FAIL  $1"; }
as_browser() { sudo -u abby-browser curl -s -o /dev/null -m 4 -w '%{http_code}' "$@" 2>/dev/null; }
PUBLIC_IP=""
[ -f /etc/default/abby-browser ] && . /etc/default/abby-browser

sudo -n systemctl start abby-browser
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  curl -s -m 1 http://127.0.0.1:9222/json/version >/dev/null && break
  sleep 0.5
done
curl -s -m 2 http://127.0.0.1:9222/json/version | grep -q '"Browser"' && ok "CDP answers on 127.0.0.1:9222" || no "CDP answers on 127.0.0.1:9222"
ps -o args= -u abby-browser | grep -q -- '--no-sandbox' && no "Chromium runs with its sandbox" || ok "Chromium runs with its sandbox"
MEM="$(systemctl show abby-browser -p MemoryMax --value)"
[ "$MEM" = "629145600" ] && ok "memory capped at 600M" || no "memory capped at 600M (got $MEM)"

[ "$(as_browser https://example.com)" = "200" ] && ok "internet reachable" || no "internet reachable"
for T in http://127.0.0.1:3105/ http://127.0.0.1:5432/ http://127.0.0.1:6379/ http://169.254.169.254/ http://10.0.0.1/ ${PUBLIC_IP:+http://$PUBLIC_IP/}; do
  CODE="$(as_browser "$T")"
  [ "$CODE" = "000" ] && ok "refused: $T" || no "reachable: $T ($CODE)"
done
sudo -u abby-browser test -r /home/ubuntu/ascend/backend/.env 2>/dev/null && no "cannot read the API's .env" || ok "cannot read the API's .env"

sudo -n systemctl stop abby-browser
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
