#!/bin/bash
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

# Wait for apt locks (cloud-init race)
for i in $(seq 1 30); do
  if ! fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

apt-get update -y
apt-get install -y ca-certificates curl gnupg apt-transport-https

# Prefer docker.io from Ubuntu (simple, reliable for Shipdeck demos)
apt-get install -y docker.io docker-compose-v2 docker-compose-plugin || apt-get install -y docker.io docker-compose || apt-get install -y docker.io
systemctl enable --now docker || true

# Allow default admin users to run docker without sudo on next login
for u in shipdeck ubuntu; do
  if id "$u" >/dev/null 2>&1; then
    usermod -aG docker "$u" || true
  fi
done

docker --version || true
docker compose version || true
echo "SHIPDECK_DOCKER_READY" > /var/log/shipdeck-docker-ready
