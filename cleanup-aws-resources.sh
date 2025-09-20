#!/bin/bash

# AWS Resource Cleanup Script for photo3s-dev
# This script deletes ALL AWS resources created by the Terraform configuration
# to ensure a clean slate for deployment.
# WARNING: This will permanently delete resources!
# This should only need to be used if the terraform state is lost or corrupted.

set -e  # Exit on any error

# Configuration - matches your dev.tfvars
PROJECT_NAME="photo3s"
ENVIRONMENT="dev"
AWS_REGION="us-east-1"
BUCKET_ROOTS=("sailing" "mics")

# Derived names (matching Terraform locals)
NAME_PREFIX="${PROJECT_NAME}-${ENVIRONMENT}"
LAMBDA_FUNCTION_NAME="${NAME_PREFIX}-photo-processor"
ECR_REPO_NAME="${NAME_PREFIX}-lambda"
IAM_ROLE_NAME="${NAME_PREFIX}-lambda-role"
LOG_GROUP_NAME="/aws/lambda/${LAMBDA_FUNCTION_NAME}"

echo "🧹 Starting cleanup of AWS resources for ${NAME_PREFIX}..."
echo "⚠️  This will DELETE resources permanently. Press Ctrl+C to cancel."
echo "   Continuing in 5 seconds..."
sleep 5

# Function to check if resource exists and delete it
delete_if_exists() {
    local resource_type=$1
    local resource_name=$2
    local check_command=$3
    local delete_command=$4
    
    echo "🔍 Checking ${resource_type}: ${resource_name}"
    if eval $check_command >/dev/null 2>&1; then
        if eval $delete_command; then
            echo "✅ Deleted ${resource_type}: ${resource_name}"
        else
            echo "❌ Failed to delete ${resource_type}: ${resource_name}"
        fi
    else
        echo "ℹ️  ${resource_type} ${resource_name} not found or already deleted"
    fi
}

# 1. Delete Lambda Function
echo ""
echo "🔥 Deleting Lambda Function..."
delete_if_exists "Lambda Function" "$LAMBDA_FUNCTION_NAME" \
    "aws lambda get-function --function-name $LAMBDA_FUNCTION_NAME --region $AWS_REGION" \
    "aws lambda delete-function --function-name $LAMBDA_FUNCTION_NAME --region $AWS_REGION"

# 2. Delete CloudWatch Log Group
echo ""
echo "🔥 Deleting CloudWatch Log Group..."
delete_if_exists "Log Group" "$LOG_GROUP_NAME" \
    "MSYS_NO_PATHCONV=1 aws logs describe-log-groups --log-group-name-prefix '$LOG_GROUP_NAME' --region $AWS_REGION --query 'logGroups[0].logGroupName' --output text | grep -q '$LOG_GROUP_NAME'" \
    "MSYS_NO_PATHCONV=1 aws logs delete-log-group --log-group-name '$LOG_GROUP_NAME' --region $AWS_REGION"

# 3. Delete S3 Buckets (must empty first, then delete)
echo ""
echo "🔥 Deleting S3 Buckets..."
for root in "${BUCKET_ROOTS[@]}"; do
    for suffix in "ingress" "processed"; do
        BUCKET_NAME="${PROJECT_NAME}-${ENVIRONMENT}-${root}-${suffix}"
        echo "🗑️  Processing bucket: $BUCKET_NAME"
        
        # Check if bucket exists
        if aws s3api head-bucket --bucket "$BUCKET_NAME" --region "$AWS_REGION" 2>/dev/null; then
            # Empty the bucket first (delete all objects and versions)
            echo "   Emptying bucket contents..."
            aws s3 rm s3://$BUCKET_NAME --recursive --region $AWS_REGION 2>/dev/null || true
            
            # Delete all object versions and delete markers
            aws s3api list-object-versions --bucket $BUCKET_NAME --region $AWS_REGION --query 'Versions[].{Key:Key,VersionId:VersionId}' --output text 2>/dev/null | while read key versionId; do
                if [ ! -z "$key" ] && [ ! -z "$versionId" ]; then
                    aws s3api delete-object --bucket $BUCKET_NAME --key "$key" --version-id "$versionId" --region $AWS_REGION 2>/dev/null || true
                fi
            done
            
            aws s3api list-object-versions --bucket $BUCKET_NAME --region $AWS_REGION --query 'DeleteMarkers[].{Key:Key,VersionId:VersionId}' --output text 2>/dev/null | while read key versionId; do
                if [ ! -z "$key" ] && [ ! -z "$versionId" ]; then
                    aws s3api delete-object --bucket $BUCKET_NAME --key "$key" --version-id "$versionId" --region $AWS_REGION 2>/dev/null || true
                fi
            done
            
            # Delete the bucket
            aws s3api delete-bucket --bucket $BUCKET_NAME --region $AWS_REGION 2>/dev/null
            echo "✅ Deleted bucket: $BUCKET_NAME"
        else
            echo "ℹ️  Bucket $BUCKET_NAME not found"
        fi
    done
done

# 4. Delete ECR Repository
echo ""
echo "🔥 Deleting ECR Repository..."
delete_if_exists "ECR Repository" "$ECR_REPO_NAME" \
    "aws ecr describe-repositories --repository-names $ECR_REPO_NAME --region $AWS_REGION" \
    "aws ecr delete-repository --repository-name $ECR_REPO_NAME --force --region $AWS_REGION"

# 5. Delete IAM Role and attached policies
echo ""
echo "🔥 Deleting IAM Role and policies..."

# 5. Delete IAM Role and attached policies
echo ""
echo "� Deleting IAM Role and policies..."

# Check if role exists first
if aws iam get-role --role-name "$IAM_ROLE_NAME" >/dev/null 2>&1; then
    echo "🔍 Found IAM role: $IAM_ROLE_NAME"
    
    # First, detach managed policies
    echo "   Detaching managed policies..."
    aws iam list-attached-role-policies --role-name "$IAM_ROLE_NAME" --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null | tr '\t' '\n' | while read policy_arn; do
        if [ ! -z "$policy_arn" ] && [ "$policy_arn" != "None" ]; then
            aws iam detach-role-policy --role-name "$IAM_ROLE_NAME" --policy-arn "$policy_arn" 2>/dev/null || true
            echo "     Detached: $policy_arn"
        fi
    done

    # Delete inline policies
    echo "   Deleting inline policies..."
    aws iam list-role-policies --role-name "$IAM_ROLE_NAME" --query 'PolicyNames' --output text 2>/dev/null | tr '\t' '\n' | while read policy_name; do
        if [ ! -z "$policy_name" ] && [ "$policy_name" != "None" ]; then
            aws iam delete-role-policy --role-name "$IAM_ROLE_NAME" --policy-name "$policy_name" 2>/dev/null || true
            echo "     Deleted: $policy_name"
        fi
    done

    # Wait for policy detachments to propagate
    echo "   Waiting for policy detachments to propagate..."
    sleep 3

    # Delete the role
    if aws iam delete-role --role-name "$IAM_ROLE_NAME"; then
        echo "✅ Deleted IAM role: $IAM_ROLE_NAME"
    else
        echo "❌ Failed to delete IAM role: $IAM_ROLE_NAME"
    fi
else
    echo "ℹ️  IAM role $IAM_ROLE_NAME not found"
fi

echo ""
echo "🎉 Cleanup complete! All ${NAME_PREFIX} resources have been deleted."
echo "🚀 You can now run Terraform apply with a clean slate."
echo ""
echo "Resources cleaned up:"
echo "   • Lambda Function: $LAMBDA_FUNCTION_NAME"
echo "   • CloudWatch Log Group: $LOG_GROUP_NAME"
echo "   • S3 Buckets: $(printf '%s-%s-%s-{ingress,processed} ' $PROJECT_NAME $ENVIRONMENT "${BUCKET_ROOTS[@]}")"
echo "   • ECR Repository: $ECR_REPO_NAME"
echo "   • IAM Role: $IAM_ROLE_NAME (with all attached policies)"