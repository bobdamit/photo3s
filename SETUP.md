# Photo Processing Lambda - Setup Checklist

Complete this checklist before deploying your Lambda function.

## Prerequisites ✅

- [ ] AWS CLI installed and configured (`aws configure`)
- [ ] Node.js 16+ installed
- [ ] S3 bucket created for photo uploads
- [ ] AWS account ID and region identified

## Deployment Steps ✅

### 1. Configure Environment Variables

Edit the `deploy.sh` script or set environment variables:

```bash
export BUCKET_NAME="your-actual-bucket-name"
export AWS_REGION="us-east-1"
export AWS_ACCOUNT_ID="123456789012"
export FUNCTION_NAME="photo-processor"
```

### 2. Create IAM Role (One-time setup)

```bash
# Create trust policy file
cat > trust-policy.json << 'EOF'
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
EOF

# Create the role
aws iam create-role \
  --role-name lambda-execution-role \
  --assume-role-policy-document file://trust-policy.json

# Attach basic execution policy
aws iam attach-role-policy \
  --role-name lambda-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Create and attach S3 policy (replace YOUR-BUCKET-NAME)
aws iam put-role-policy \
  --role-name lambda-execution-role \
  --policy-name S3PhotoProcessingPolicy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "s3:GetObject",
          "s3:PutObject",
          "s3:GetObjectMetadata"
        ],
        "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
      }
    ]
  }'
```

### 3. Deploy Lambda Function

```bash
./deploy.sh
```

### 4. Test the Setup

```bash
# Upload a test photo
aws s3 cp your-test-photo.jpg s3://YOUR-BUCKET-NAME/

# Check if processed files were created
aws s3 ls s3://YOUR-BUCKET-NAME/processed/

# View Lambda logs
aws logs tail /aws/lambda/photo-processor --follow
```

## Verification Checklist ✅

After deployment, verify:

- [ ] Lambda function created successfully
- [ ] S3 bucket trigger configured
- [ ] IAM permissions set correctly
- [ ] Test photo upload processed successfully
- [ ] Multiple image sizes generated
- [ ] JSON metadata file created
- [ ] CloudWatch logs showing successful execution

## Common Issues & Solutions 🔧

### Issue: Permission Denied
**Solution**: Check IAM role has S3 permissions for your specific bucket

### Issue: Lambda Timeout
**Solution**: Increase timeout in deploy script or AWS console (current: 60 seconds)

### Issue: Sharp Module Error
**Solution**: Ensure you're deploying from a Linux environment or use AWS Lambda Layers

### Issue: Large Image Processing Fails
**Solution**: Increase Lambda memory allocation (current: 512MB)

### Issue: Function Not Triggered
**Solution**: Verify S3 bucket notification configuration and Lambda permissions

## Quick Commands Reference 📝

```bash
# Update function code only
npm run zip && aws lambda update-function-code --function-name photo-processor --zip-file fileb://photo-lambda.zip

# View recent logs
aws logs tail /aws/lambda/photo-processor --since 10m

# Test Lambda directly
aws lambda invoke --function-name photo-processor --payload file://test-event.json response.json

# List processed files
aws s3 ls s3://YOUR-BUCKET-NAME/processed/ --recursive

# Download metadata file
aws s3 cp s3://YOUR-BUCKET-NAME/processed/photo-2024-09-19_14-30-25-Canon.json .
```

## Environment Variables (Optional)

You can set these in Lambda console for configuration:
- `DEBUG`: Set to "true" for verbose logging
- `MAX_IMAGE_SIZE`: Maximum image dimension (default: 1920)
- `JPEG_QUALITY`: JPEG compression quality (default: 85)

---

**Need help?** Check the README.md for detailed instructions or AWS CloudWatch logs for error details.