# Terraform Bootstrap (EC2 + EBS + CloudFront + ACM)

This creates:
- EC2 (Amazon Linux 2023) with Docker Compose
- EBS volume mounted at `/data` for MongoDB and invoice uploads
- App deployment from a GitHub repository/branch on EC2
- Two CloudFront distributions:
- `inventory.barreldrop.co.zw` -> EC2 origin port `80`
- `api.barreldrop.co.zw` -> EC2 origin port `4000`
- ACM certs in `us-east-1` (required by CloudFront)
- Elastic IP for stable origin

## 1) Set the GitHub source

Pass these variables via `terraform.tfvars` or `-var` flags:

- `github_repo_url` (example: `https://github.com/<org>/<repo>.git`)
- `github_branch` (example: `main`)

If your repo is private, switch to an HTTPS URL with token auth or a deploy key flow before first apply.

## 2) Create SSM Parameters

Create parameters at `/barreldrop/prod`:

- `PORT=4000`
- `MONGO_URI=mongodb://mongo:27017/barreldrop`
- `JWT_SECRET=...`
- `CORS_ORIGIN=https://inventory.barreldrop.co.zw`
- `COOKIE_SECURE=true`
- `VITE_API_URL=https://api.barreldrop.co.zw`

For local invoice uploads on EBS, do not set `AWS_REGION` or `S3_BUCKET`.

## 3) Apply Terraform (two-step because ACM needs DNS validation)

```bash
cd infra
terraform init

# Step 1: create ACM certificates
terraform apply -target=aws_acm_certificate.inventory -target=aws_acm_certificate.api
```

Terraform outputs `inventory_cert_validation` and `api_cert_validation`.
Create those DNS records at your registrar (Webdev Zim).

After the certs are issued:

```bash
terraform apply \
  -var='github_repo_url=https://github.com/<org>/<repo>.git' \
  -var='github_branch=main'
```

## 4) DNS records for CloudFront

Use the output values:
- `inventory_cloudfront_domain`
- `api_cloudfront_domain`

Create CNAME records at Webdev Zim:
- `inventory.barreldrop.co.zw` -> `<inventory_cloudfront_domain>`
- `api.barreldrop.co.zw` -> `<api_cloudfront_domain>`

## 5) Origin record (stable)

Create an A record:
- `origin.barreldrop.co.zw` -> `<ec2_public_ip>`

This keeps CloudFront origin stable even if the EC2 instance is replaced (re-attach the same EIP).

## Updating after first deploy

To redeploy newer code from GitHub on the same branch:

```bash
cd infra
terraform apply
```

If `user_data` does not rerun on your existing instance, run this once on EC2:

```bash
cd /opt/barreldrop/repo
git pull --ff-only
set -a
. /etc/barreldrop/frontend.env
set +a
docker compose -f infra/docker-compose.infra.yml up -d --build
```

## Notes

- EC2 origin is public (ports 80 and 4000). CloudFront is the primary entry point.
- If you replace the EC2 instance, re-apply Terraform to update the CloudFront origin to the new EC2 public DNS.
