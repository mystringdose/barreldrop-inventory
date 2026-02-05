#!/usr/bin/env bash
set -euo pipefail

mkdir -p /etc/barreldrop

aws ssm get-parameters-by-path \
  --path "/barreldrop/prod" \
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
