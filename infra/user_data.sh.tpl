#!/usr/bin/env bash
set -euo pipefail

dnf update -y
dnf install -y git awscli

# Install Docker + Compose with Amazon Linux package-name fallbacks.
if dnf list --available docker-compose-plugin >/dev/null 2>&1; then
  dnf install -y docker docker-compose-plugin
elif dnf list --available docker-compose >/dev/null 2>&1; then
  dnf install -y docker docker-compose
else
  dnf install -y docker
fi

systemctl enable --now docker

mkdir -p /opt/barreldrop
mkdir -p /etc/barreldrop

# Mount EBS volume for MongoDB. Prefer the attached /dev/sdf alias if present.
DATA_DEV=""
if [ -b /dev/nvme1n1 ]; then
  DATA_DEV="/dev/nvme1n1"
elif [ -b /dev/xvdf ]; then
  DATA_DEV="/dev/xvdf"
else
  DATA_DEV="$(lsblk -dpno NAME,TYPE,MOUNTPOINT | awk '$2=="disk" && $3=="" {print $1}' | head -n 1)"
fi

if [ -n "$${DATA_DEV}" ]; then
  if ! blkid "$${DATA_DEV}" >/dev/null 2>&1; then
    mkfs.xfs "$${DATA_DEV}"
  fi
  mkdir -p /data
  if ! mountpoint -q /data; then
    mount "$${DATA_DEV}" /data || true
  fi
  mkdir -p /data/mongo /data/uploads
  chmod 755 /data/mongo /data/uploads
  grep -q "$${DATA_DEV} /data" /etc/fstab || echo "$${DATA_DEV} /data xfs defaults,nofail 0 2" >> /etc/fstab
fi

# Pull env vars from SSM Parameter Store
aws ssm get-parameters-by-path \
  --path "${ssm_path}" \
  --with-decryption \
  --query "Parameters[*].[Name,Value]" \
  --output text | while read -r name value; do
    key="$${name##*/}"
    echo "$${key}=$${value}"
  done > /etc/barreldrop/all.env

grep -E '^(PORT|MONGO_URI|JWT_SECRET|CORS_ORIGIN|COOKIE_SECURE|SESSION_TTL_HOURS|AWS_REGION|S3_BUCKET)=' /etc/barreldrop/all.env \
  > /etc/barreldrop/api.env

grep -E '^(VITE_API_URL)=' /etc/barreldrop/all.env \
  > /etc/barreldrop/frontend.env

if [ ! -d /opt/barreldrop/repo/.git ]; then
  git clone --depth 1 --branch "${github_branch}" "${github_repo_url}" /opt/barreldrop/repo
else
  cd /opt/barreldrop/repo
  git fetch origin "${github_branch}"
  git checkout -B "${github_branch}" "origin/${github_branch}"
fi

cd /opt/barreldrop/repo
set -a
. /etc/barreldrop/frontend.env
set +a

if docker compose version >/dev/null 2>&1; then
  docker compose -f infra/docker-compose.infra.yml up -d --build
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose -f infra/docker-compose.infra.yml up -d --build
else
  echo "No Docker Compose command found" >&2
  exit 1
fi
