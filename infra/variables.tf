variable "aws_region" {
  type        = string
  description = "AWS region for EC2 and primary resources."
  default     = "af-south-1"
}

variable "instance_type" {
  type        = string
  description = "EC2 instance type."
  default     = "t3a.small"
}

variable "mongo_volume_gb" {
  type        = number
  description = "EBS volume size for MongoDB data."
  default     = 20
}

variable "inventory_domain" {
  type        = string
  description = "Frontend domain."
  default     = "inventory.barreldrop.co.zw"
}

variable "api_domain" {
  type        = string
  description = "API domain."
  default     = "api.barreldrop.co.zw"
}

variable "origin_domain" {
  type        = string
  description = "Stable origin domain pointing to the EC2 Elastic IP."
  default     = "origin.barreldrop.co.zw"
}

variable "dockerhub_api_image" {
  type        = string
  description = "Docker Hub image for API."
  default     = "yourdockerhub/barreldrop-api:latest"
}

variable "dockerhub_frontend_image" {
  type        = string
  description = "Docker Hub image for frontend."
  default     = "yourdockerhub/barreldrop-frontend:latest"
}

variable "ssm_path" {
  type        = string
  description = "SSM Parameter Store path prefix."
  default     = "/barreldrop/prod"
}
