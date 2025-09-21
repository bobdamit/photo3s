output "lambda_function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.photo_processor.function_name
}

output "lambda_function_arn" {
  description = "ARN of the Lambda function"
  value       = aws_lambda_function.photo_processor.arn
}

output "ecr_repository_url" {
  description = "ECR repository URL for Lambda container (managed by CI/CD)"
  value       = data.aws_ecr_repository.lambda_repo.repository_url
}

output "ecr_repository_name" {
  description = "ECR repository name for Lambda container (managed by CI/CD)"
  value       = data.aws_ecr_repository.lambda_repo.name
}

output "bucket_pairs" {
  description = "Map of bucket pairs (root_name -> {ingress, processed})"
  value       = local.bucket_pairs
}

output "ingress_buckets" {
  description = "List of ingress S3 buckets (where photos are uploaded)"
  value       = local.ingress_buckets
}

output "processed_buckets" {
  description = "List of processed S3 buckets (where processed photos are stored)"
  value       = local.processed_buckets
}

output "created_buckets" {
  description = "Map of created S3 buckets by type"
  value = {
    ingress   = { for k, v in aws_s3_bucket.ingress_buckets : k => v.bucket }
    processed = { for k, v in aws_s3_bucket.processed_buckets : k => v.bucket }
  }
}

output "lambda_log_group" {
  description = "CloudWatch log group for Lambda function"
  value       = aws_cloudwatch_log_group.lambda_logs.name
}

output "lambda_role_arn" {
  description = "ARN of the Lambda execution role"
  value       = aws_iam_role.lambda_role.arn
}

output "monitoring_alarms" {
  description = "List of CloudWatch alarm names"
  value = var.enable_monitoring ? [
    aws_cloudwatch_metric_alarm.lambda_errors[0].alarm_name,
    aws_cloudwatch_metric_alarm.lambda_duration[0].alarm_name,
    aws_cloudwatch_metric_alarm.lambda_throttles[0].alarm_name
  ] : []
}