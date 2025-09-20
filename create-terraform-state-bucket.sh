#!/bin/bash

# Create S3 bucket for Terraform state management
# This needs to be done once before enabling the S3 backend

set -e

PROJECT_NAME="photo3s"
ENVIRONMENT="dev"
AWS_REGION="us-east-1"
STATE_BUCKET="${PROJECT_NAME}-${ENVIRONMENT}-terraform-state"

echo "🪣 Creating Terraform state bucket: ${STATE_BUCKET}"

# Create the bucket
if [ "${AWS_REGION}" == "us-east-1" ]; then
    # us-east-1 doesn't use LocationConstraint
    aws s3api create-bucket --bucket "${STATE_BUCKET}" --region "${AWS_REGION}"
else
    # Other regions need LocationConstraint
    aws s3api create-bucket \
        --bucket "${STATE_BUCKET}" \
        --region "${AWS_REGION}" \
        --create-bucket-configuration LocationConstraint="${AWS_REGION}"
fi

# Enable versioning (critical for state safety)
echo "🔄 Enabling versioning..."
aws s3api put-bucket-versioning \
    --bucket "${STATE_BUCKET}" \
    --versioning-configuration Status=Enabled

# Enable encryption
echo "🔒 Enabling encryption..."
aws s3api put-bucket-encryption \
    --bucket "${STATE_BUCKET}" \
    --server-side-encryption-configuration '{
        "Rules": [
            {
                "ApplyServerSideEncryptionByDefault": {
                    "SSEAlgorithm": "AES256"
                }
            }
        ]
    }'

# Block public access
echo "🚫 Blocking public access..."
aws s3api put-public-access-block \
    --bucket "${STATE_BUCKET}" \
    --public-access-block-configuration \
        BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "✅ Terraform state bucket created and configured: ${STATE_BUCKET}"
echo "📝 Now configure your backend in versions.tf:"
echo ""
echo "  backend \"s3\" {"
echo "    bucket = \"${STATE_BUCKET}\""
echo "    key    = \"terraform.tfstate\""
echo "    region = \"${AWS_REGION}\""
echo "  }"