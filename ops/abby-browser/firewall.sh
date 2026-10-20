#!/bin/sh
# Keeps Abby's browser on the public internet and off this box. Runs as root
# before every start (abby-browser.service, ExecStartPre=+). Idempotent: the
# ABBY_BROWSER chain is rebuilt each time.
#
# Matched by the abby-browser user, on NEW connections only — the API talking
# to Chromium's CDP port, and Chromium's replies, are untouched. Everything
# the browser itself dials goes through here:
#
#   allowed   DNS to systemd-resolved (127.0.0.53:53), and the internet
#   refused   127/8 (Postgres, Redis, the API, BTCPay's tunnel), the private
#             and link-local ranges (169.254.169.254 is the cloud metadata
#             service), carrier-grade NAT, multicast, and this server's own
#             public address — which would reach the store's nginx directly
#
# A web page cannot get past this by DNS tricks either: a name that resolves
# to 127.0.0.1 is still a connection to 127.0.0.1.
set -eu

USER_NAME=abby-browser
# This box's public IPv4, from /etc/default/abby-browser (install.sh writes it).
PUBLIC_IP=""
[ -f /etc/default/abby-browser ] && . /etc/default/abby-browser

for IPT in iptables ip6tables; do
  $IPT -N ABBY_BROWSER 2>/dev/null || $IPT -F ABBY_BROWSER
  $IPT -C OUTPUT -m owner --uid-owner "$USER_NAME" -j ABBY_BROWSER 2>/dev/null ||
    $IPT -I OUTPUT 1 -m owner --uid-owner "$USER_NAME" -j ABBY_BROWSER
  $IPT -A ABBY_BROWSER -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
done

iptables -A ABBY_BROWSER -d 127.0.0.53 -p udp --dport 53 -j RETURN
iptables -A ABBY_BROWSER -d 127.0.0.53 -p tcp --dport 53 -j RETURN
for NET in 127.0.0.0/8 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/4 240.0.0.0/4 $PUBLIC_IP; do
  iptables -A ABBY_BROWSER -d "$NET" -j REJECT
done
for NET in ::1/128 ::/128 ::ffff:0:0/96 fc00::/7 fe80::/10 ff00::/8; do
  ip6tables -A ABBY_BROWSER -d "$NET" -j REJECT
done
