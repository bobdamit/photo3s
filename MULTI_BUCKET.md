# Multi-Bucket Configuration Options

This document explains different approaches to handle multiple S3 buckets with your photo processing Lambda.

## Option 1: Environment Variables (Recommended) 🌟

**Benefits**: No code changes, highly configurable, easy to manage
**Best for**: Multiple environments, different bucket configurations per deployment

### Environment Variables You Can Set:

```bash
# Restrict which buckets can trigger processing (comma-separated)
ALLOWED_SOURCE_BUCKETS=bucket-1,bucket-2,my-photos

# Use different bucket for processed files (optional)
PROCESSED_BUCKET=my-processed-photos

# Custom prefix for processed files
PROCESSED_PREFIX=processed/

# Delete original after processing
DELETE_ORIGINAL=false

# Skip files already in processed folder
SKIP_PROCESSED_FOLDER=true
```

### AWS Lambda Console Setup:
1. Go to Lambda Console → Your Function → Configuration → Environment variables
2. Add the variables above
3. No code deployment needed!

### GitHub Actions Setup:
Configure deployment using GitHub Repository Secrets and Variables:

**GitHub Repository Secrets** (Settings → Secrets and variables → Actions → Repository secrets):
```bash
# Required AWS credentials (keep these as secrets - they're sensitive)
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
LAMBDA_FUNCTION_NAME=phot3s-upload-lambda
```

**GitHub Repository Variables** (Settings → Secrets and variables → Actions → Variables):
```bash
# S3 bucket configuration (use variables - not sensitive information)
ALLOWED_SOURCE_BUCKETS=bucket-1,bucket-2,my-photos
PROCESSED_BUCKET=my-processed-photos
PROCESSED_PREFIX=processed/
DELETE_ORIGINAL=false
```

**Why Variables instead of Secrets?**
- 🔒 **Secrets**: For sensitive data (AWS keys, passwords) - hidden in logs
- 📋 **Variables**: For configuration (bucket names, prefixes) - visible in workflow runs
- 🎯 **Better practice**: Bucket names aren't sensitive, so Variables are more appropriate

The GitHub Actions workflow will automatically:
- Create IAM roles with permissions for the specified buckets
- Configure Lambda environment variables from the variables
- Deploy with the correct bucket access policies

## Option 2: Multiple Lambda Functions

**Benefits**: Complete isolation, different configurations per bucket
**Best for**: Different processing requirements per bucket

### Deployment:
```bash
# Deploy for bucket 1
export LAMBDA_FUNCTION_NAME=photo-processor-bucket1
export S3_BUCKET_NAME=my-photos-bucket1
./deploy.sh

# Deploy for bucket 2  
export LAMBDA_FUNCTION_NAME=photo-processor-bucket2
export S3_BUCKET_NAME=my-photos-bucket2
./deploy.sh
```

## Option 3: Single Trigger, Multiple Bucket Support

**Benefits**: One Lambda handles all buckets, centralized processing
**Setup**: Configure Lambda to trigger from multiple buckets

### S3 Trigger Configuration:
```bash
# Configure multiple buckets to trigger the same Lambda
for bucket in bucket1 bucket2 bucket3; do
  aws s3api put-bucket-notification-configuration \
    --bucket $bucket \
    --notification-configuration '{
      "LambdaConfigurations": [
        {
          "Id": "photo-processing-trigger-'$bucket'",
          "LambdaFunctionArn": "arn:aws:lambda:REGION:ACCOUNT:function:photo-processor",
          "Events": ["s3:ObjectCreated:*"],
          "Filter": {
            "Key": {
              "FilterRules": [{"Name": "suffix", "Value": ".jpg"}]
            }
          }
        }
      ]
    }'
done
```

## Usage Examples

### Example 1: Personal Photos (Same Bucket)
```bash
# Environment Variables:
PROCESSED_PREFIX=processed/
DELETE_ORIGINAL=false
# No ALLOWED_SOURCE_BUCKETS = allows any bucket
```

### Example 2: Multi-Tenant (Separate Processed Bucket)
```bash
# Environment Variables:
ALLOWED_SOURCE_BUCKETS=customer-uploads-bucket1,customer-uploads-bucket2
PROCESSED_BUCKET=processed-photos-central
PROCESSED_PREFIX=processed/
DELETE_ORIGINAL=true
```

### Example 3: Development vs Production
```bash
# Development:
ALLOWED_SOURCE_BUCKETS=dev-photos
PROCESSED_PREFIX=dev-processed/
DELETE_ORIGINAL=false

# Production:
ALLOWED_SOURCE_BUCKETS=prod-photos-1,prod-photos-2
PROCESSED_BUCKET=prod-processed-photos
PROCESSED_PREFIX=processed/
DELETE_ORIGINAL=true
```

## Updated Lambda Function Features

The Lambda function now supports:

✅ **Bucket Validation**: Only processes allowed source buckets
✅ **Cross-Bucket Processing**: Can write to different target bucket  
✅ **Configurable Prefixes**: Custom folder structure
✅ **Original File Management**: Option to delete original after processing
✅ **Detailed Logging**: Shows source → target bucket flow
✅ **Metadata Tracking**: Records source/target bucket in JSON

## Deployment Commands

### Update Environment Variables Only:
```bash
aws lambda update-function-configuration \
  --function-name photo-processor \
  --environment Variables='{
    "ALLOWED_SOURCE_BUCKETS": "bucket1,bucket2",
    "PROCESSED_BUCKET": "my-processed-bucket",
    "PROCESSED_PREFIX": "processed/",
    "DELETE_ORIGINAL": "false"
  }'
```

### Full Re-deployment with New Config:
```bash
# Set environment variables
export ALLOWED_SOURCE_BUCKETS=bucket1,bucket2
export PROCESSED_BUCKET=my-processed-bucket

# Deploy
./deploy.sh
```

## IAM Permissions Required

Your Lambda execution role needs permissions for all buckets:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::source-bucket1/*",
        "arn:aws:s3:::source-bucket2/*"
      ]
    },
    {
      "Effect": "Allow", 
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::processed-bucket/*",
        "arn:aws:s3:::source-bucket1/*",
        "arn:aws:s3:::source-bucket2/*"
      ]
    }
  ]
}
```

## Recommendation

**Start with Option 1 (Environment Variables)** - it's the most flexible and requires no code changes. You can easily:

1. Set different configurations per environment
2. Add/remove buckets without redeployment  
3. Change processing behavior via AWS Console
4. Keep one codebase for multiple use cases

Would you like me to implement the environment variable approach in your current code?