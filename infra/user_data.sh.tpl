#!/usr/bin/env bash
set -euo pipefail

dnf update -y
dnf install -y docker docker-compose-plugin
systemctl enable --now docker

mkdir -p /opt/barreldrop
mkdir -p /etc/barreldrop

# Mount EBS volume for MongoDB
DATA_DEV="$(lsblk -pn -o NAME,MOUNTPOINT | awk '$2==\"\" {print $1}' | head -n 1)"
if [ -n "${DATA_DEV}" ]; then
  if ! file -s "${DATA_DEV}" | grep -q filesystem; then
    mkfs.xfs "${DATA_DEV}"
  fi
  mkdir -p /data
  mount "${DATA_DEV}" /data || true
  mkdir -p /data/mongo
  chmod 755 /data/mongo
  grep -q "${DATA_DEV} /data" /etc/fstab || echo "${DATA_DEV} /data xfs defaults,nofail 0 2" >> /etc/fstab
fi

# Pull env vars from SSM Parameter Store
aws ssm get-parameters-by-path \
  --path "${ssm_path}" \
  --with-decryption \
  --query "Parameters[*].[Name,Value]" \
  --output text | while read -r name value; do
    key="${name##*/}"
    echo "${key}=${value}"
  done > /etc/barreldrop/all.env

grep -E '^(PORT|MONGO_URI|JWT_SECRET|CORS_ORIGIN|COOKIE_SECURE|AWS_REGION|S3_BUCKET)=' /etc/barreldrop/all.env \
  > /etc/barreldrop/api.env

grep -E '^(VITE_API_URL)=' /etc/barreldrop/all.env \
  > /etc/barreldrop/frontend.env

cat <<'EOF' > /opt/barreldrop/docker-compose.yml
${compose_yaml}
EOF

cd /opt/barreldrop
docker compose up -d
