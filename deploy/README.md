# EC2 Deployment (Amazon Linux 2023)

This guide deploys the frontend, API, and MongoDB using Docker Compose on one EC2 instance, with EBS-backed MongoDB data, Nginx, and Let's Encrypt SSL.

## 1) EC2 + EBS Setup

1. Launch EC2 (Amazon Linux 2023) with a security group that allows:
   - 22/tcp from your IP
   - 80/tcp from 0.0.0.0/0
   - 443/tcp from 0.0.0.0/0
2. Create and attach an EBS volume to the instance (e.g., 20GB gp3).
3. On the instance:

```bash
sudo lsblk
sudo mkfs.xfs /dev/nvme1n1
sudo mkdir -p /data
sudo mount /dev/nvme1n1 /data
sudo mkdir -p /data/mongo
sudo chown -R ec2-user:ec2-user /data/mongo
echo "/dev/nvme1n1 /data xfs defaults,nofail 0 2" | sudo tee -a /etc/fstab
```

## 2) Install Docker + Compose

```bash
sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
newgrp docker
```

## 3) Clone Repo

```bash
git clone https://github.com/<your-org>/<your-repo>.git
cd <your-repo>
```

## 4) Parameter Store

Create parameters in AWS SSM Parameter Store (Path: `/barreldrop/prod`):

- `PORT=4000`
- `MONGO_URI=mongodb://mongo:27017/barreldrop`
- `JWT_SECRET=...`
- `CORS_ORIGIN=https://inventory.barreldrop.co.zw`
- `COOKIE_SECURE=true`
- `AWS_REGION=...`
- `S3_BUCKET=...`
- `VITE_API_URL=https://api.barreldrop.co.zw`

Then run:

```bash
chmod +x deploy/ssm-to-env.sh
sudo deploy/ssm-to-env.sh
```

## 5) Build + Run Containers

```bash
docker compose -f deploy/docker-compose.prod.yml build
docker compose -f deploy/docker-compose.prod.yml up -d
```

## 6) Nginx + SSL

```bash
sudo dnf install -y nginx certbot python3-certbot-nginx
sudo systemctl enable --now nginx
sudo cp deploy/nginx.conf /etc/nginx/conf.d/barreldrop.conf
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d inventory.barreldrop.co.zw -d api.barreldrop.co.zw
```

## 7) DNS

Create A records:
- `inventory.barreldrop.co.zw` -> EC2 public IP
- `api.barreldrop.co.zw` -> EC2 public IP

## 8) Verify

```bash
curl -I https://inventory.barreldrop.co.zw
curl -I https://api.barreldrop.co.zw/health
```
