#!/bin/bash

# Quick deployment script for photo processing Lambda
# Edit the variables below before running

set -e  # Exit on any error

echo "🚀 Photo Processing Lambda Deployment Script"
echo "============================================="

# Configuration - CHANGE THESE VALUES
BUCKET_NAME="${BUCKET_NAME:-your-photo-bucket}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-123456789012}"
FUNCTION_NAME="${FUNCTION_NAME:-photo-processor}"
ROLE_NAME="${ROLE_NAME:-lambda-execution-role}"

echo "Configuration:"
echo "  Bucket: $BUCKET_NAME"
echo "  Region: $AWS_REGION"
echo "  Account ID: $AWS_ACCOUNT_ID"
echo "  Function: $FUNCTION_NAME"
echo ""

# Check if AWS CLI is configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS CLI not configured. Run 'aws configure' first."
    exit 1
fi

echo "✅ AWS CLI configured"

# Build the deployment package
echo "📦 Building deployment package..."
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

npm run zip
echo "✅ Deployment package created"

# Check if Lambda function exists
if aws lambda get-function --function-name $FUNCTION_NAME &> /dev/null; then
    echo "🔄 Lambda function exists, updating code..."
    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://photo-lambda.zip \
        --region $AWS_REGION
    echo "✅ Lambda function updated"
else
    echo "🆕 Creating new Lambda function..."
    
    # Check if role exists
    if ! aws iam get-role --role-name $ROLE_NAME &> /dev/null; then
        echo "❌ IAM role '$ROLE_NAME' not found."
        echo "Create it first with the instructions in README.md"
        exit 1
    fi
    
    ROLE_ARN="arn:aws:iam::$AWS_ACCOUNT_ID:role/$ROLE_NAME"
    
    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime nodejs18.x \
        --role $ROLE_ARN \
        --handler upload-lambda.handler \
        --zip-file fileb://photo-lambda.zip \
        --timeout 60 \
        --memory-size 512 \
        --region $AWS_REGION
    
    echo "✅ Lambda function created"
fi

# Configure S3 trigger (only if bucket notification doesn't exist)
echo "🔗 Configuring S3 trigger..."

# Check if bucket exists
if ! aws s3api head-bucket --bucket $BUCKET_NAME &> /dev/null; then
    echo "❌ Bucket '$BUCKET_NAME' not found or not accessible"
    exit 1
fi

# Create notification configuration
LAMBDA_ARN="arn:aws:lambda:$AWS_REGION:$AWS_ACCOUNT_ID:function:$FUNCTION_NAME"

aws s3api put-bucket-notification-configuration \
    --bucket $BUCKET_NAME \
    --notification-configuration "{
        \"LambdaConfigurations\": [
            {
                \"Id\": \"photo-processing-trigger\",
                \"LambdaFunctionArn\": \"$LAMBDA_ARN\",
                \"Events\": [\"s3:ObjectCreated:*\"],
                \"Filter\": {
                    \"Key\": {
                        \"FilterRules\": [
                            {
                                \"Name\": \"suffix\",
                                \"Value\": \".jpg\"
                            }
                        ]
                    }
                }
            }
        ]
    }" 2>/dev/null || echo "⚠️  S3 notification might already exist"

# Grant S3 permission to invoke Lambda
aws lambda add-permission \
    --function-name $FUNCTION_NAME \
    --principal s3.amazonaws.com \
    --action lambda:InvokeFunction \
    --source-arn "arn:aws:s3:::$BUCKET_NAME" \
    --statement-id s3-trigger \
    --region $AWS_REGION 2>/dev/null || echo "⚠️  Permission might already exist"

echo "✅ S3 trigger configured"

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "Test by uploading a photo:"
echo "  aws s3 cp your-photo.jpg s3://$BUCKET_NAME/"
echo ""
echo "View logs:"
echo "  aws logs tail /aws/lambda/$FUNCTION_NAME --follow"
echo ""
echo "Check processed files:"
echo "  aws s3 ls s3://$BUCKET_NAME/processed/"