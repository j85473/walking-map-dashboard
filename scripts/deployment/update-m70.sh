#!/usr/bin/env bash
set -Eeuo pipefail

exec 9>/run/lock/walking-dashboard-update.lock
flock -n 9 || exit 0

repo=https://github.com/j85473/walking-map-dashboard.git
releases=/opt/walking-dashboard-releases
active=/opt/walking-dashboard
host=100.107.116.123
mkdir -p "$releases"

revision=$(git ls-remote "$repo" refs/heads/main | awk '{print $1}')
[[ $revision =~ ^[0-9a-f]{40}$ ]] || { echo 'Cannot identify GitHub main'; exit 1; }
if [[ $(readlink -f "$active" 2>/dev/null || true) == "$releases/$revision" ]]; then
  echo "Walking Dashboard already runs $revision"
  exit 0
fi

# Only a successful verification run for this exact commit may become live.
runs=$(curl --fail --silent --show-error --retry 2 --max-time 20 \
  -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/j85473/walking-map-dashboard/actions/workflows/verify.yml/runs?branch=main&per_page=20")
conclusion=$(jq -r --arg revision "$revision" \
  '[.workflow_runs[] | select(.head_sha == $revision)] | sort_by(.run_number) | last | .conclusion // "pending"' <<<"$runs")
if [[ $conclusion != success ]]; then
  echo "Waiting for GitHub verification of $revision (current: $conclusion)"
  exit 0
fi

previous=$(readlink -f "$active" 2>/dev/null || true)
if [[ ! -d $releases/$revision ]]; then
  staging=$(mktemp -d "$releases/.stage.XXXXXX")
  trap 'rm -rf -- "$staging"' EXIT
  git clone --quiet --depth 1 --branch main "$repo" "$staging/source"
  [[ $(git -C "$staging/source" rev-parse HEAD) == "$revision" ]] || {
    echo 'main advanced during clone; retry on next check'
    exit 0
  }
  chown -R walking-dashboard:walking-dashboard "$staging"
  runuser -u walking-dashboard -- bash -c '
    set -euo pipefail
    cd "$1"
    npm ci --no-audit --no-fund
    npx prisma generate
    DATABASE_URL=postgresql://invalid:invalid@127.0.0.1:1/career_db?schema=walking_map npm run build
  ' _ "$staging/source"
  mv "$staging/source" "$releases/$revision"
  rmdir "$staging"
  trap - EXIT
fi

ln -sfn "$releases/$revision" "$active.new"
mv -Tf "$active.new" "$active"
systemctl restart walking-dashboard.service

healthy=0
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 3 "http://$host:3005/api/health" 2>/dev/null \
      | jq -e '.status == "ok" and (.walkCount | type == "number") and .walkCount > 0' >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ $healthy != 1 ]]; then
  echo "Walking Dashboard $revision failed health check; restoring prior release" >&2
  if [[ -n $previous && -d $previous ]]; then
    ln -sfn "$previous" "$active.new"
    mv -Tf "$active.new" "$active"
    systemctl restart walking-dashboard.service
  else
    systemctl stop walking-dashboard.service || true
    rm -f "$active"
  fi
  exit 1
fi

# Future checks run the updater that was verified and activated with this release.
install -m 755 "$active/scripts/deployment/update-m70.sh" /usr/local/sbin/walking-dashboard-update
printf '%s\n' "$revision" > /var/lib/walking-dashboard/active-revision
echo "Activated Walking Dashboard $revision"
