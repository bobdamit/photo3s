# Local values for resource naming and configuration
locals {
  name_prefix = "${var.project_name}-${var.environment}"
  
  # Generate bucket names from roots
  bucket_pairs = {
    for root in var.bucket_roots : root => {
      ingress   = "${var.bucket_prefix}-${var.environment}-${root}-ingress"
      processed = "${var.bucket_prefix}-${var.environment}-${root}-processed"
    }
  }
  
  # Flatten for easy reference
  ingress_buckets   = [for pair in local.bucket_pairs : pair.ingress]
  processed_buckets = [for pair in local.bucket_pairs : pair.processed]
  all_buckets      = concat(local.ingress_buckets, local.processed_buckets)
  
  # Create the bucket mapping structure that Lambda expects: ingress_bucket -> processed_bucket
  lambda_bucket_mappings = {
    for root, buckets in local.bucket_pairs : buckets.ingress => {
      processed = buckets.processed
    }
  }
  
  # Lambda environment variables
  lambda_environment = {
    DELETE_ORIGINAL          = tostring(var.delete_original)
    CHECK_DUPLICATES         = tostring(var.check_duplicates)
    DUPLICATE_ACTION         = var.duplicate_action
    DUPLICATES_PREFIX        = "duplicates/"
    ALLOWED_SOURCE_BUCKETS   = join(",", local.ingress_buckets)
    BUCKET_MAPPINGS          = jsonencode(local.lambda_bucket_mappings)
  }
  
  # Common tags
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    Component   = "photo-processing"
  }
}

#===============================================================================
# S3 Buckets - Auto-generated pairs from bucket roots
#===============================================================================

# Ingress buckets (where photos are uploaded)
resource "aws_s3_bucket" "ingress_buckets" {
  for_each = local.bucket_pairs
  
  bucket = each.value.ingress
  
  tags = merge(local.common_tags, {
    Name = each.value.ingress
    Type = "ingress-bucket"
    Root = each.key
  })
}

resource "aws_s3_bucket_versioning" "ingress_buckets" {
  for_each = local.bucket_pairs
  
  bucket = aws_s3_bucket.ingress_buckets[each.key].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "ingress_buckets" {
  for_each = local.bucket_pairs
  
  bucket = aws_s3_bucket.ingress_buckets[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "ingress_buckets" {
  for_each = local.bucket_pairs
  
  bucket = aws_s3_bucket.ingress_buckets[each.key].id

  rule {
    id     = "delete_all_files"
    status = "Enabled"
    
    # Delete all files after retention period - ingress buckets are ephemeral
    filter {}
    
    expiration {
      days = var.ingress_retention_days
    }
    
    noncurrent_version_expiration {
      noncurrent_days = var.ingress_retention_days
    }
    
    abort_incomplete_multipart_upload {
      days_after_initiation = var.ingress_retention_days
    }
  }
}

# Processed buckets (where processed photos are stored)
resource "aws_s3_bucket" "processed_buckets" {
  for_each = local.bucket_pairs
  
  bucket = each.value.processed
  
  tags = merge(local.common_tags, {
    Name = each.value.processed
    Type = "processed-bucket"
    Root = each.key
  })
}

resource "aws_s3_bucket_versioning" "processed_buckets" {
  for_each = local.bucket_pairs
  
  bucket = aws_s3_bucket.processed_buckets[each.key].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "processed_buckets" {
  for_each = local.bucket_pairs
  
  bucket = aws_s3_bucket.processed_buckets[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "processed_buckets" {
  for_each = local.bucket_pairs
  
  bucket = aws_s3_bucket.processed_buckets[each.key].id

  rule {
    id     = "cleanup_incomplete_uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
  
  rule {
    id     = "transition_old_versions"
    status = "Enabled"
    
    filter {}
    
    noncurrent_version_transition {
      noncurrent_days = 30
      storage_class   = "STANDARD_IA"
    }
    
    noncurrent_version_transition {
      noncurrent_days = 90
      storage_class   = "GLACIER"
    }
  }
}

# Public access configuration for processed buckets (allow public read access)
resource "aws_s3_bucket_public_access_block" "processed_buckets" {
  for_each = local.bucket_pairs
  
  bucket = aws_s3_bucket.processed_buckets[each.key].id

  # Allow public access for serving photos
  block_public_acls       = true  # Still block public ACLs for security
  block_public_policy     = false # Allow bucket policies (needed for public read)
  ignore_public_acls      = true  # Ignore public ACLs for security  
  restrict_public_buckets = false # Allow bucket to be public via policy
}

# Bucket policy to allow public read and list access to processed photos
resource "aws_s3_bucket_policy" "processed_buckets" {
  for_each = local.bucket_pairs
  
  bucket = aws_s3_bucket.processed_buckets[each.key].id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowPublicRead"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.processed_buckets[each.key].arn}/*"
        Condition = {
          StringNotEquals = {
            "s3:ExistingObjectTag/private" = "true"
          }
        }
      },
      {
        Sid       = "AllowPublicList"
        Effect    = "Allow"
        Principal = "*"
        Action    = "s3:ListBucket"
        Resource  = aws_s3_bucket.processed_buckets[each.key].arn
      }
    ]
  })
  
  depends_on = [aws_s3_bucket_public_access_block.processed_buckets]
}

#===============================================================================
# ECR Repository Reference (managed by CI/CD pipeline)
#===============================================================================

# Reference to ECR repository created by GitHub Actions
data "aws_ecr_repository" "lambda_repo" {
  name = "${local.name_prefix}-lambda"
}

#===============================================================================
# Docker Image Build and Push (Legacy - prefer pre-built images)
#===============================================================================

# Only build locally if no pre-built image URI is provided
locals {
  # Use pre-built image if provided, otherwise build locally
  use_prebuilt_image = var.lambda_image_uri != ""
  
  # Generate unique tag for local builds only
  code_hash = substr(sha256(join("", [
    filemd5("${path.module}/../upload-lambda.js"),
    filemd5("${path.module}/../package.json"),
    filemd5("${path.module}/../Dockerfile")
  ])), 0, 8)
  
  local_image_tag = "v${local.code_hash}"
  
  # Final image URI - use pre-built or local
  lambda_image_uri = local.use_prebuilt_image ? var.lambda_image_uri : "${data.aws_ecr_repository.lambda_repo.repository_url}:${local.local_image_tag}"
}

# Local Docker build (only if no pre-built image provided)
resource "null_resource" "lambda_image_build" {
  count = local.use_prebuilt_image ? 0 : 1
  
  triggers = {
    lambda_code_hash = filemd5("${path.module}/../upload-lambda.js")
    package_hash     = filemd5("${path.module}/../package.json")
    dockerfile_hash  = filemd5("${path.module}/../Dockerfile")
    ecr_repo_url     = data.aws_ecr_repository.lambda_repo.repository_url
    image_tag        = local.local_image_tag
  }

  provisioner "local-exec" {
    command = <<-EOT
      echo "🏗️ Building Lambda image locally (consider using CI/CD pipeline instead)"
      
      # Login to ECR
      aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${data.aws_ecr_repository.lambda_repo.repository_url}
      
      # Build and tag the image with unique tag
      docker build -t ${data.aws_ecr_repository.lambda_repo.repository_url}:${local.local_image_tag} ${path.module}/..
      
      # Also tag as latest for convenience
      docker tag ${data.aws_ecr_repository.lambda_repo.repository_url}:${local.local_image_tag} ${data.aws_ecr_repository.lambda_repo.repository_url}:latest
      
      # Push both tags
      docker push ${data.aws_ecr_repository.lambda_repo.repository_url}:${local.local_image_tag}
      docker push ${data.aws_ecr_repository.lambda_repo.repository_url}:latest
    EOT
  }

  depends_on = [data.aws_ecr_repository.lambda_repo]
}

#===============================================================================
# IAM Role and Policies for Lambda
#===============================================================================

resource "aws_iam_role" "lambda_role" {
  name = "${local.name_prefix}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
  
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-lambda-role"
  })
}

# Basic Lambda execution policy
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.lambda_role.name
}

# X-Ray tracing policy (optional)
resource "aws_iam_role_policy_attachment" "lambda_xray" {
  count      = var.enable_xray ? 1 : 0
  policy_arn = "arn:aws:iam::aws:policy/AWSXRayDaemonWriteAccess"
  role       = aws_iam_role.lambda_role.name
}

# S3 permissions policy
resource "aws_iam_role_policy" "lambda_s3_policy" {
  name = "${local.name_prefix}-lambda-s3-policy"
  role = aws_iam_role.lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Read and delete access to ingress buckets (delete needed for 'replace' duplicate action)
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:DeleteObject"
        ]
        Resource = [
          for bucket in local.ingress_buckets : "arn:aws:s3:::${bucket}/*"
        ]
      },
      # List access to ingress buckets for duplicate checking
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [
          for bucket in local.ingress_buckets : "arn:aws:s3:::${bucket}"
        ]
      },
      # Full access to all processed buckets
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
          "s3:PutObjectAcl"
        ]
        Resource = flatten([
          for bucket in local.processed_buckets : [
            "arn:aws:s3:::${bucket}",
            "arn:aws:s3:::${bucket}/*"
          ]
        ])
      },
      # Copy permissions between all buckets
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:PutObjectAcl"
        ]
        Resource = [
          for bucket in local.all_buckets : "arn:aws:s3:::${bucket}/*"
        ]
      }
    ]
  })
}

#===============================================================================
# Lambda Function
#===============================================================================

resource "aws_lambda_function" "photo_processor" {
  function_name = "${local.name_prefix}-photo-processor"
  role         = aws_iam_role.lambda_role.arn
  
  # Container image configuration - use pre-built or locally built image
  package_type = "Image"
  image_uri    = local.lambda_image_uri
  
  # Function configuration
  memory_size = var.lambda_memory
  timeout     = var.lambda_timeout
  
  environment {
    variables = local.lambda_environment
  }
  
  # Optional tracing
  dynamic "tracing_config" {
    for_each = var.enable_xray ? [1] : []
    content {
      mode = "Active"
    }
  }
  
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-photo-processor"
  })
  
  depends_on = [
    aws_iam_role_policy_attachment.lambda_basic,
    aws_cloudwatch_log_group.lambda_logs,
  ]
}

#===============================================================================
# CloudWatch Logs
#===============================================================================

resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/${local.name_prefix}-photo-processor"
  retention_in_days = var.log_retention_days
  
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-lambda-logs"
  })
}

#===============================================================================
# S3 Event Notifications - Only ingress buckets trigger Lambda
#===============================================================================

resource "aws_s3_bucket_notification" "ingress_bucket_notifications" {
  for_each = local.bucket_pairs
  
  bucket = each.value.ingress

  lambda_function {
    lambda_function_arn = aws_lambda_function.photo_processor.arn
    events             = ["s3:ObjectCreated:*"]
    
  }
  
  depends_on = [aws_lambda_permission.s3_invoke]
}

resource "aws_lambda_permission" "s3_invoke" {
  for_each = local.bucket_pairs
  
  statement_id  = "AllowExecutionFromS3-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.photo_processor.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = "arn:aws:s3:::${each.value.ingress}"
}