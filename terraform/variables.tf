variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
  
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be dev, staging, or prod."
  }
}

variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "photo3s"
}

variable "bucket_roots" {
  description = "List of root names for bucket pairs (each creates {prefix}-{root}-ingress and {prefix}-{root}-processed)"
  type        = list(string)
  default     = []
  
  validation {
    condition     = length(var.bucket_roots) > 0
    error_message = "At least one bucket root name must be specified."
  }
  
  validation {
    condition = alltrue([
      for root in var.bucket_roots : can(regex("^[a-z0-9][a-z0-9-]*[a-z0-9]$", root))
    ])
    error_message = "Bucket root names must contain only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen."
  }
}

variable "bucket_prefix" {
  description = "Prefix for all bucket names (e.g., 'photo3s' creates photo3s-dev-photos-ingress)"
  type        = string
  default     = "photo3s"
  
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]*[a-z0-9]$", var.bucket_prefix))
    error_message = "Bucket prefix must contain only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen."
  }
}



variable "lambda_memory" {
  description = "Memory allocation for Lambda function (MB)"
  type        = number
  default     = 512
  
  validation {
    condition     = var.lambda_memory >= 128 && var.lambda_memory <= 10240
    error_message = "Lambda memory must be between 128 and 10240 MB."
  }
}

variable "lambda_timeout" {
  description = "Timeout for Lambda function (seconds)"
  type        = number
  default     = 90
  
  validation {
    condition     = var.lambda_timeout >= 1 && var.lambda_timeout <= 900
    error_message = "Lambda timeout must be between 1 and 900 seconds."
  }
}

variable "delete_original" {
  description = "Whether Lambda should delete original files after processing (deprecated - use lifecycle policies instead)"
  type        = bool
  default     = false  # S3 lifecycle policies handle cleanup automatically
}

variable "ingress_retention_days" {
  description = "Number of days to retain ALL files in ephemeral ingress buckets before automatic deletion"
  type        = number
  default     = 2
  
  validation {
    condition     = var.ingress_retention_days >= 1 && var.ingress_retention_days <= 30
    error_message = "Ingress retention days must be between 1 and 30."
  }
}

variable "lambda_image_uri" {
  description = "Pre-built Lambda container image URI from ECR (overrides local Docker build)"
  type        = string
  default     = ""
}

variable "check_duplicates" {
  description = "Whether to check for duplicates before processing"
  type        = bool
  default     = true
}

variable "duplicate_action" {
  description = "Action for duplicate files: delete, move, keep, or replace"
  type        = string
  default     = "replace"
  
  validation {
    condition     = contains(["delete", "move", "keep", "replace"], var.duplicate_action)
    error_message = "Duplicate action must be delete, move, keep, or replace."
  }
}

variable "enable_monitoring" {
  description = "Enable CloudWatch monitoring and alarms"
  type        = bool
  default     = true
}

variable "enable_xray" {
  description = "Enable X-Ray tracing for Lambda"
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "CloudWatch log retention period in days"
  type        = number
  default     = 14
  
  validation {
    condition = contains([
      1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653
    ], var.log_retention_days)
    error_message = "Log retention days must be a valid CloudWatch retention period."
  }
}

variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default     = {}
}