output "ec2_public_ip" {
  value       = aws_eip.app.public_ip
  description = "EC2 public IP (origin)."
}

output "ec2_public_dns" {
  value       = aws_eip.app.public_dns
  description = "EC2 public DNS (origin for CloudFront)."
}

output "inventory_cloudfront_domain" {
  value       = aws_cloudfront_distribution.inventory.domain_name
  description = "CloudFront domain for inventory site."
}

output "api_cloudfront_domain" {
  value       = aws_cloudfront_distribution.api.domain_name
  description = "CloudFront domain for API."
}

output "inventory_cert_validation" {
  value       = aws_acm_certificate.inventory.domain_validation_options
  description = "DNS validation records for inventory cert."
}

output "api_cert_validation" {
  value       = aws_acm_certificate.api.domain_validation_options
  description = "DNS validation records for API cert."
}
