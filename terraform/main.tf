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
  
  # Lambda environment variables
  lambda_environment = {
    AWS_REGION                = var.aws_region
    PROCESSED_PREFIX         = "processed/"
    DELETE_ORIGINAL          = tostring(var.delete_original)
    CHECK_DUPLICATES         = tostring(var.check_duplicates)
    DUPLICATE_ACTION         = var.duplicate_action
    DUPLICATES_PREFIX        = "duplicates/"
    SKIP_PROCESSED_FOLDER    = "true"
    ALLOWED_SOURCE_BUCKETS   = join(",", local.ingress_buckets)
    BUCKET_MAPPINGS          = jsonencode(local.bucket_pairs)
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
  for_each = var.create_buckets ? local.bucket_pairs : {}
  
  bucket = each.value.ingress
  
  tags = merge(local.common_tags, {
    Name = each.value.ingress
    Type = "ingress-bucket"
    Root = each.key
  })
}

resource "aws_s3_bucket_versioning" "ingress_buckets" {
  for_each = var.create_buckets ? local.bucket_pairs : {}
  
  bucket = aws_s3_bucket.ingress_buckets[each.key].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "ingress_buckets" {
  for_each = var.create_buckets ? local.bucket_pairs : {}
  
  bucket = aws_s3_bucket.ingress_buckets[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "ingress_buckets" {
  for_each = var.create_buckets ? local.bucket_pairs : {}
  
  bucket = aws_s3_bucket.ingress_buckets[each.key].id

  rule {
    id     = "cleanup_incomplete_uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
  
  rule {
    id     = "transition_duplicates"
    status = "Enabled"
    
    filter {
      prefix = "duplicates/"
    }

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
    
    transition {
      days          = 90
      storage_class = "GLACIER"
    }
  }
}

# Processed buckets (where processed photos are stored)
resource "aws_s3_bucket" "processed_buckets" {
  for_each = var.create_buckets ? local.bucket_pairs : {}
  
  bucket = each.value.processed
  
  tags = merge(local.common_tags, {
    Name = each.value.processed
    Type = "processed-bucket"
    Root = each.key
  })
}

resource "aws_s3_bucket_versioning" "processed_buckets" {
  for_each = var.create_buckets ? local.bucket_pairs : {}
  
  bucket = aws_s3_bucket.processed_buckets[each.key].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "processed_buckets" {
  for_each = var.create_buckets ? local.bucket_pairs : {}
  
  bucket = aws_s3_bucket.processed_buckets[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "processed_buckets" {
  for_each = var.create_buckets ? local.bucket_pairs : {}
  
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

#===============================================================================
# ECR Repository for Lambda Container
#===============================================================================

#===============================================================================
# ECR Repository for Lambda Container
#===============================================================================

resource "aws_ecr_repository" "lambda_repo" {
  name                 = "${local.name_prefix}-lambda"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }
  
  tags = merge(local.common_tags, {
    Name = "${local.name_prefix}-lambda-repo"
  })
}

resource "aws_ecr_lifecycle_policy" "lambda_repo" {
  repository = aws_ecr_repository.lambda_repo.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 5 images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["v"]
          countType     = "imageCountMoreThan"
          countNumber   = 5
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 2
        description  = "Delete untagged images"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

#===============================================================================
# Docker Image Build and Push
#===============================================================================

resource "null_resource" "lambda_image_build" {
  triggers = {
    lambda_code_hash = filemd5("${path.module}/../upload-lambda.js")
    package_hash     = filemd5("${path.module}/../package.json")
    dockerfile_hash  = filemd5("${path.module}/../Dockerfile")
    ecr_repo_url     = aws_ecr_repository.lambda_repo.repository_url
  }

  provisioner "local-exec" {
    command = <<-EOT
      # Login to ECR
      aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${aws_ecr_repository.lambda_repo.repository_url}
      
      # Build and tag the image
      docker build -t ${aws_ecr_repository.lambda_repo.repository_url}:latest ${path.module}/..
      
      # Push the image
      docker push ${aws_ecr_repository.lambda_repo.repository_url}:latest
    EOT
  }

  depends_on = [aws_ecr_repository.lambda_repo]
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
      # Read access to ingress buckets
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion"
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
  
  # Container image configuration
  package_type = "Image"
  image_uri    = "${aws_ecr_repository.lambda_repo.repository_url}:latest"
  
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
    null_resource.lambda_image_build
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