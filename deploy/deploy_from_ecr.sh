#!/usr/bin/env bash
set -euo pipefail

IMAGE_TAG="${1:-latest}"

: "${AWS_REGION:?AWS_REGION is required}"
: "${ECR_REGISTRY:?ECR_REGISTRY is required}"
: "${ECR_FRONTEND_REPOSITORY:?ECR_FRONTEND_REPOSITORY is required}"
: "${ECR_API_REPOSITORY:?ECR_API_REPOSITORY is required}"
: "${ECR_MONGO_REPOSITORY:?ECR_MONGO_REPOSITORY is required}"

cd /opt/barreldrop/repo

aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ECR_REGISTRY}"

export IMAGE_TAG
export ECR_REGISTRY
export ECR_FRONTEND_REPOSITORY
export ECR_API_REPOSITORY
export ECR_MONGO_REPOSITORY

if docker compose version >/dev/null 2>&1; then
  docker compose -f infra/docker-compose.ecr.yml pull
  docker compose -f infra/docker-compose.ecr.yml up -d --remove-orphans
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose -f infra/docker-compose.ecr.yml pull
  docker-compose -f infra/docker-compose.ecr.yml up -d --remove-orphans
else
  echo "No Docker Compose command found" >&2
  exit 1
fi

# Keep the host from accumulating old layers indefinitely.
docker image prune -f
