# Production environment configuration
environment = "prod"
aws_region  = "us-east-1"

# S3 Configuration - AUTO-GENERATED BUCKET PAIRS
bucket_prefix = "photo3s"                          # Creates photo3s-prod-* buckets
bucket_roots  = ["sailing", "mics"]                # Creates 4 buckets total:
                                                   #   photo3s-prod-sailing-ingress
                                                   #   photo3s-prod-sailing-processed
                                                   #   photo3s-prod-mics-ingress
                                                   #   photo3s-prod-mics-processed
create_buckets = true

# Lambda Configuration
lambda_memory    = 1024  # More memory for production
lambda_timeout   = 90    # Longer timeout for large files
delete_original  = true  # Delete originals in production
check_duplicates = true
duplicate_action = "replace"  # Replace existing processed files with new uploads

# Monitoring
enable_monitoring  = true
enable_xray       = false  # Disable X-Ray in prod to reduce costs
log_retention_days = 30

# Tags
tags = {
  Environment = "production"
  Owner       = "photo3s-team"
  CostCenter  = "production"
  Backup      = "required"
}
