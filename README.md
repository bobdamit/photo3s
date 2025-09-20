# Photo Processing Lambda

An AWS Lambda function that automatically processes photo uploads to S3 by:
- Creating multiple image sizes (small, medium, large) 
- Extracting EXIF metadata including GPS coordinates
- Renaming files based on shot date from metadata
- Generating comprehensive JSON metadata files

## Features

- **Multiple Image Sizes**: Automatically generates small (300px), medium (800px), and large (1920px) versions
- **EXIF Data Extraction**: Extracts camera settings, GPS coordinates, and shot dates
- **Smart Renaming**: Renames files based on actual photo date: `photo-YYYY-MM-DD_HH-MM-SS-camera.jpg`
- **Comprehensive Metadata**: Creates detailed JSON files with all photo information
- **Error Handling**: Robust error handling with CloudWatch logging
- **Format Support**: JPG, JPEG, PNG, TIFF, WebP

## File Structure Created

```
processed/
├── photo-2024-09-19_14-30-25-Canon.jpg          # Original with new name
├── photo-2024-09-19_14-30-25-Canon_large.jpg    # 1920px version
├── photo-2024-09-19_14-30-25-Canon_medium.jpg   # 800px version  
├── photo-2024-09-19_14-30-25-Canon_small.jpg    # 300px version
└── photo-2024-09-19_14-30-25-Canon.json         # Metadata file
```

## Prerequisites

- AWS CLI configured with appropriate permissions
- Node.js 16+ installed locally
- An S3 bucket for photo uploads

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create deployment package:**
   ```bash
   npm run zip
   ```

## Deployment Steps

### Step 1: Create the Lambda Function

```bash
# Create the Lambda function
aws lambda create-function \
  --function-name photo-processor \
  --runtime nodejs18.x \
  --role arn:aws:iam::YOUR_ACCOUNT_ID:role/lambda-execution-role \
  --handler upload-lambda.handler \
  --zip-file fileb://photo-lambda.zip \
  --timeout 60 \
  --memory-size 512
```

**Important**: Replace `YOUR_ACCOUNT_ID` with your actual AWS account ID.

### Step 2: Create IAM Role (if you don't have one)

Create a file called `trust-policy.json`:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

Create the role:
```bash
aws iam create-role \
  --role-name lambda-execution-role \
  --assume-role-policy-document file://trust-policy.json
```

Attach policies:
```bash
# Basic Lambda execution
aws iam attach-role-policy \
  --role-name lambda-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# S3 access (replace YOUR-BUCKET-NAME)
aws iam put-role-policy \
  --role-name lambda-execution-role \
  --policy-name S3Access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "s3:GetObject",
          "s3:PutObject"
        ],
        "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
      }
    ]
  }'
```

### Step 3: Configure S3 Bucket Trigger

1. **Add S3 notification configuration:**
   ```bash
   aws s3api put-bucket-notification-configuration \
     --bucket YOUR-BUCKET-NAME \
     --notification-configuration '{
       "LambdaConfigurations": [
         {
           "Id": "photo-processing-trigger",
           "LambdaFunctionArn": "arn:aws:lambda:YOUR-REGION:YOUR_ACCOUNT_ID:function:photo-processor",
           "Events": ["s3:ObjectCreated:*"],
           "Filter": {
             "Key": {
               "FilterRules": [
                 {
                   "Name": "prefix",
                   "Value": "uploads/"
                 },
                 {
                   "Name": "suffix",
                   "Value": ".jpg"
                 }
               ]
             }
           }
         }
       ]
     }'
   ```

2. **Grant S3 permission to invoke Lambda:**
   ```bash
   aws lambda add-permission \
     --function-name photo-processor \
     --principal s3.amazonaws.com \
     --action lambda:InvokeFunction \
     --source-arn arn:aws:s3:::YOUR-BUCKET-NAME \
     --statement-id s3-trigger
   ```

## Quick Setup Script

Replace the variables and run this script for quick deployment:

```bash
#!/bin/bash

# Configuration - CHANGE THESE VALUES
BUCKET_NAME="your-photo-bucket"
AWS_REGION="us-east-1"
AWS_ACCOUNT_ID="123456789012"
FUNCTION_NAME="photo-processor"

# Build and deploy
npm install
npm run zip

# Create Lambda function
aws lambda create-function \
  --function-name $FUNCTION_NAME \
  --runtime nodejs18.x \
  --role arn:aws:iam::$AWS_ACCOUNT_ID:role/lambda-execution-role \
  --handler upload-lambda.handler \
  --zip-file fileb://photo-lambda.zip \
  --timeout 60 \
  --memory-size 512 \
  --region $AWS_REGION

# Configure S3 trigger
aws s3api put-bucket-notification-configuration \
  --bucket $BUCKET_NAME \
  --notification-configuration "$(cat <<EOF
{
  "LambdaConfigurations": [
    {
      "Id": "photo-processing-trigger",
      "LambdaFunctionArn": "arn:aws:lambda:$AWS_REGION:$AWS_ACCOUNT_ID:function:$FUNCTION_NAME",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {
              "Name": "suffix",
              "Value": ".jpg"
            }
          ]
        }
      }
    }
  ]
}
EOF
)"

# Grant S3 permission
aws lambda add-permission \
  --function-name $FUNCTION_NAME \
  --principal s3.amazonaws.com \
  --action lambda:InvokeFunction \
  --source-arn arn:aws:s3:::$BUCKET_NAME \
  --statement-id s3-trigger \
  --region $AWS_REGION

echo "Deployment complete! Upload photos to s3://$BUCKET_NAME/ to test."
```

## Testing

1. **Upload a photo to your S3 bucket:**
   ```bash
   aws s3 cp your-photo.jpg s3://YOUR-BUCKET-NAME/uploads/
   ```

2. **Check CloudWatch logs:**
   ```bash
   aws logs describe-log-groups --log-group-name-prefix /aws/lambda/photo-processor
   ```

3. **View processed files:**
   ```bash
   aws s3 ls s3://YOUR-BUCKET-NAME/processed/
   ```

## Updating the Function

After making code changes:

```bash
npm run zip
aws lambda update-function-code \
  --function-name photo-processor \
  --zip-file fileb://photo-lambda.zip
```

## Troubleshooting

### Common Issues:

1. **Permission Denied**: Ensure Lambda execution role has S3 permissions
2. **Timeout Errors**: Increase Lambda timeout for large images
3. **Memory Issues**: Increase Lambda memory allocation
4. **Sharp Module Issues**: Ensure you're using Lambda-compatible sharp binary

### Viewing Logs:

```bash
aws logs tail /aws/lambda/photo-processor --follow
```

### Function Monitoring:

Check the AWS Lambda console for:
- Invocation count
- Error rate  
- Duration metrics
- Memory usage

## Configuration

The function processes images in the root of the bucket by default. To change the trigger path, modify the S3 notification configuration's `prefix` filter.

Supported formats: JPG, JPEG, PNG, TIFF, WebP

## Dependencies

- `aws-sdk`: AWS SDK for JavaScript
- `sharp`: High-performance image processing
- `exif-parser`: EXIF metadata extraction

## License

ISC# SSH is better for regular development!
