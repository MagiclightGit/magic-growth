#!/usr/bin/env bash
set -euo pipefail
if test -f /opt/guangmo/bootstrap-complete; then
  exit 0
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y ca-certificates curl gnupg python3
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo 'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable' > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

data_device=/dev/disk/by-id/google-guangmo-data
if ! blkid "$data_device"; then
  mkfs.ext4 -m 0 "$data_device"
fi
mkdir -p /srv/guangmo /opt/guangmo
data_uuid=$(blkid -s UUID -o value "$data_device")
if ! grep -q "UUID=$data_uuid " /etc/fstab; then
  echo "UUID=$data_uuid /srv/guangmo ext4 defaults 0 2" >> /etc/fstab
fi
mountpoint -q /srv/guangmo || mount /srv/guangmo
# Refuse to start containers if the persistent disk cannot be mounted.
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/guangmo-data.conf <<'EOF'
[Unit]
RequiresMountsFor=/srv/guangmo
EOF
systemctl daemon-reload
systemctl enable --now docker
chmod 700 /opt/guangmo
touch /opt/guangmo/bootstrap-complete
