#!/bin/sh
# Installs Abby's browser on the VPS. Run once, as ubuntu, from the repo:
#
#   sh ops/abby-browser/install.sh            # public IP looked up
#   sh ops/abby-browser/install.sh 1.2.3.4    # or given
#
# then add to backend/.env and restart ascend-api:
#
#   AGENT_BROWSER=on
#   BROWSER_START_CMD=sudo -n systemctl start abby-browser
#   BROWSER_STOP_CMD=sudo -n systemctl stop abby-browser
#
# and prove the fence with: sh ops/abby-browser/check.sh
# Re-running is safe; it is also how Chromium is updated after an
# @playwright/mcp upgrade.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PUBLIC_IP="${1:-$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')}"
case "$PUBLIC_IP" in *.*.*.*) ;; *) echo "could not work out this server's public IP; pass it as the first argument" >&2; exit 1 ;; esac

sudo useradd --system --home-dir /var/lib/abby-browser --shell /usr/sbin/nologin abby-browser 2>/dev/null || true
sudo mkdir -p /opt/abby-browser/browsers
sudo install -m 755 "$HERE/launch.sh" "$HERE/firewall.sh" /opt/abby-browser/

# Playwright's Chromium, the build the API's playwright-core is made for, plus
# the system libraries and fonts it needs. Full Chromium, not the headless
# shell: the shell is what bot walls recognise first.
cd "$REPO/backend"
sudo env PLAYWRIGHT_BROWSERS_PATH=/opt/abby-browser/browsers npx playwright install --with-deps --no-shell chromium
sudo chmod -R a+rX /opt/abby-browser/browsers

sudo install -m 644 "$HERE/apparmor" /etc/apparmor.d/abby-chromium
sudo apparmor_parser -r /etc/apparmor.d/abby-chromium

echo "PUBLIC_IP=$PUBLIC_IP" | sudo tee /etc/default/abby-browser >/dev/null
sudo install -m 644 "$HERE/abby-browser.service" /etc/systemd/system/abby-browser.service
sudo install -m 440 "$HERE/sudoers" /etc/sudoers.d/abby-browser
sudo visudo -cf /etc/sudoers.d/abby-browser
sudo systemctl daemon-reload

echo "installed. Chromium: $(ls -d /opt/abby-browser/browsers/chromium-*/chrome-linux*/chrome | sort -V | tail -1)"
