# Development environment configuration
environment = "dev"
aws_region  = "us-east-1"

# S3 Configuration - AUTO-GENERATED BUCKET PAIRS
# Each root creates: {prefix}-{env}-{root}-ingress and {prefix}-{env}-{root}-processed
bucket_prefix = "photo3s"                    # Creates photo3s-dev-* buckets
bucket_roots  = ["sailing", "mics"]       # Creates 4 buckets total:
                                              #   photo3s-dev-sailing-ingress
                                              #   photo3s-dev-sailing-processed
                                              #   photo3s-dev-mics-ingress
                                              #   photo3s-dev-mics-processed
create_buckets = true
ingress_retention_days = 3                   # Ephemeral ingress - delete ALL files after 3 days

# Lambda Configuration
lambda_memory  = 512
lambda_timeout = 60
delete_original = false  # S3 lifecycle policies handle cleanup automatically
check_duplicates = true
duplicate_action = "replace"  # Replace existing processed files with new uploads

# Monitoring
enable_monitoring = true
enable_xray      = true
log_retention_days = 7

# Tags
tags = {
  Environment = "development"
  Owner       = "photo3s-team"
  CostCenter  = "development"
}