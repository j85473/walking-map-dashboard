#!/usr/bin/env bash
set -Eeuo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root on M70' >&2; exit 1; }

root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
dns_name=$(tailscale status --json | jq -er '.Self.DNSName | select(length > 0) | rtrimstr(".")')
serve_config=$(tailscale serve status --json)
existing=$(jq -r --arg address "$dns_name:8443" '.Web[$address].Handlers["/"].Proxy // empty' <<<"$serve_config")
if jq -e '.TCP["8443"] != null' <<<"$serve_config" >/dev/null \
    && [[ $existing != http://127.0.0.1:3005 ]]; then
  echo 'Port 8443 already serves another application; leaving its configuration unchanged.' >&2
  exit 1
fi

curl --fail --silent --show-error --max-time 10 http://100.107.116.123:3005/api/health \
  | jq -e '.status == "ok" and .walkCount > 0' >/dev/null

# The app remains bound to its existing Tailscale address. Serve needs a
# loopback target; this socket adds one without exposing the app to the LAN.
install -m 644 "$root/scripts/deployment/walking-dashboard-loopback.socket" /etc/systemd/system/
install -m 644 "$root/scripts/deployment/walking-dashboard-loopback.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now walking-dashboard-loopback.socket
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3005/api/health \
  | jq -e '.status == "ok" and .walkCount > 0' >/dev/null

# Add a separate private HTTPS listener; preserve existing Serve applications.
tailscale serve --bg --https=8443 http://127.0.0.1:3005
curl --fail --silent --show-error --retry 3 --max-time 15 \
  --resolve "$dns_name:8443:100.107.116.123" "https://$dns_name:8443/api/health" \
  | jq -e '.status == "ok" and .walkCount > 0' >/dev/null
echo "Walking Dashboard HTTPS is ready: https://$dns_name:8443/"
