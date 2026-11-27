#!/usr/bin/env bash
# Run as root on the application VM after placing .env and compose.yaml.
set -euo pipefail
cd /opt/guangmo
test "$(stat -c %a .env)" = 600
mountpoint -q /srv/guangmo
registry=$(sed -n 's/^IMAGE_PREFIX=\([^/]*\).*/\1/p' .env)
test -n "$registry"
curl -fsS -H 'Metadata-Flavor: Google' \
  http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])' \
  | docker login -u oauth2accesstoken --password-stdin "$registry"
trap 'docker logout "$registry" >/dev/null 2>&1' EXIT
compose=(docker compose --env-file .env -f compose.yaml)
"${compose[@]}" config --quiet
"${compose[@]}" pull
# Drain work before schema migrations. Queue and run state remain persistent.
"${compose[@]}" stop --timeout 900 worker
"${compose[@]}" stop --timeout 30 api
"${compose[@]}" up -d --wait postgres redis
"${compose[@]}" run --rm migrate
"${compose[@]}" up -d --wait --wait-timeout 180
"${compose[@]}" ps
