#!/usr/bin/env bash
# Run from repository root. The production environment file stays local/private.
set -euo pipefail
project=magiclight-2025
zone=${GCP_ZONE:-asia-southeast1-b}
vm=guangmo-growth
production_env=${1:-.deployment/production.env}
test -f "$production_env"
ssh_args=(--project="$project" --zone="$zone" --tunnel-through-iap --quiet)
remote_dir=$(gcloud compute ssh "$vm" "${ssh_args[@]}" --command='mktemp -d /tmp/guangmo-release.XXXXXXXX')
if [[ ! "$remote_dir" =~ ^/tmp/guangmo-release\.[a-zA-Z0-9]+$ ]]; then
  echo 'Unexpected remote release directory' >&2
  exit 1
fi
gcloud compute scp "${ssh_args[@]}" \
  deploy/compose.production.yaml deploy/gcp/release.sh deploy/gcp/backup.py \
  deploy/gcp/guangmo-backup.service deploy/gcp/guangmo-backup.timer \
  "$vm:$remote_dir/"
gcloud compute ssh "$vm" "${ssh_args[@]}" \
  --command="sudo install -m 600 '$remote_dir/compose.production.yaml' /opt/guangmo/compose.yaml.next && sudo mv /opt/guangmo/compose.yaml.next /opt/guangmo/compose.yaml && sudo install -m 700 '$remote_dir/release.sh' /opt/guangmo/release.sh && sudo install -m 700 '$remote_dir/backup.py' /opt/guangmo/backup.py && sudo install -m 644 '$remote_dir/guangmo-backup.service' '$remote_dir/guangmo-backup.timer' /etc/systemd/system/ && rm -rf '$remote_dir'"
gcloud compute ssh "$vm" "${ssh_args[@]}" \
  --command="sudo sh -c 'umask 077; cat > /opt/guangmo/.env.next && mv /opt/guangmo/.env.next /opt/guangmo/.env'" < "$production_env"
gcloud compute ssh "$vm" "${ssh_args[@]}" \
  --command="sudo sh -c 'echo magiclight-2025-guangmo-backups > /opt/guangmo/backup-bucket' && sudo /opt/guangmo/release.sh && sudo systemctl daemon-reload && sudo systemctl enable --now guangmo-backup.timer && sudo systemctl start guangmo-backup.service"
