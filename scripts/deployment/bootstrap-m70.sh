#!/usr/bin/env bash
set -Eeuo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run as root on M70' >&2; exit 1; }

root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
install -d -o root -g root -m 700 /etc/walking-dashboard /var/lib/walking-dashboard

if ! id walking-dashboard >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/walking-dashboard --shell /usr/sbin/nologin walking-dashboard
fi
chown root:walking-dashboard /etc/walking-dashboard
chmod 750 /etc/walking-dashboard
install -d -o root -g walking-dashboard -m 750 /opt/walking-dashboard-releases

count=$(runuser -u postgres -- psql -d career_db -X -A -t -v ON_ERROR_STOP=1 \
  -c 'SELECT count(*) FROM walking_map."Walk"')
[[ $count =~ ^[0-9]+$ && $count -gt 0 ]] || { echo 'Walking data is missing on M70' >&2; exit 1; }

backup=/var/lib/walking-dashboard/walking-map-pre-cutover-$(date -u +%Y%m%dT%H%M%SZ).dump
runuser -u postgres -- pg_dump -Fc -n walking_map career_db > "$backup"
chmod 600 "$backup"
pg_restore --list "$backup" >/dev/null
sha256sum "$backup" > "$backup.sha256"
chmod 600 "$backup.sha256"
echo "Backed up $count walks to $backup"

if [[ ! -f /etc/walking-dashboard/runtime.env ]]; then
  password=$(openssl rand -hex 32)
  if [[ $(runuser -u postgres -- psql -d career_db -X -A -t \
      -c "SELECT 1 FROM pg_roles WHERE rolname = 'walking_dashboard'") == 1 ]]; then
    printf "ALTER ROLE walking_dashboard LOGIN PASSWORD '%s';\n" "$password" \
      | runuser -u postgres -- psql -d career_db -v ON_ERROR_STOP=1 -q >/dev/null
  else
    printf "CREATE ROLE walking_dashboard LOGIN PASSWORD '%s';\n" "$password" \
      | runuser -u postgres -- psql -d career_db -v ON_ERROR_STOP=1 -q >/dev/null
  fi
  printf 'DATABASE_URL=postgresql://walking_dashboard:%s@127.0.0.1:5432/career_db?schema=walking_map\n' "$password" \
    > /etc/walking-dashboard/runtime.env
  chown root:walking-dashboard /etc/walking-dashboard/runtime.env
  chmod 640 /etc/walking-dashboard/runtime.env
fi

runuser -u postgres -- psql -d career_db -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT CONNECT ON DATABASE career_db TO walking_dashboard;
GRANT USAGE ON SCHEMA walking_map TO walking_dashboard;
GRANT SELECT, INSERT, UPDATE ON walking_map."Walk" TO walking_dashboard;
SQL

install -m 644 "$root/scripts/deployment/walking-dashboard.service" /etc/systemd/system/
install -m 644 "$root/scripts/deployment/walking-dashboard-update.service" /etc/systemd/system/
install -m 644 "$root/scripts/deployment/walking-dashboard-update.timer" /etc/systemd/system/
install -m 755 "$root/scripts/deployment/update-m70.sh" /usr/local/sbin/walking-dashboard-update
systemctl daemon-reload
systemctl enable walking-dashboard.service
systemctl enable --now walking-dashboard-update.timer
echo 'Bootstrap complete. Run systemctl start walking-dashboard-update.service after GitHub verification succeeds.'
