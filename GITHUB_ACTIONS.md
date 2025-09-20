# GitHub Actions Setup for Lambda Deployment

This document explains how to configure GitHub secrets for automatic Lambda deployment. The workflow deploys the Lambda function and automatically creates the required IAM role if it doesn't exist.

## Required GitHub Secrets

Go to your repository → Settings → Secrets and variables → Actions → New repository secret

### 1. AWS Credentials (Required)
```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

**How to get these:**
1. Go to AWS Console → IAM → Users → Your User → Security credentials
2. Create access key for CLI/API use
3. **Important**: User needs IAM permissions to create roles and Lambda functions

### 2. Optional Configuration
```
AWS_REGION (defaults to us-east-1)
LAMBDA_FUNCTION_NAME (defaults to phot3s-upload-lambda)
```

## IAM Permissions Required

Your AWS user needs these permissions for the GitHub Action to work:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:GetFunction",
        "lambda:AddPermission",
        "iam:CreateRole",
        "iam:GetRole",
        "iam:AttachRolePolicy",
        "iam:PutRolePolicy",
        "iam:PassRole"
      ],
      "Resource": "*"
    }
  ]
}
```

## What the Workflow Does Automatically

✅ **Creates IAM Role**: Automatically creates `lambda-execution-role` if it doesn't exist  
✅ **Sets Up Permissions**: Adds Lambda execution and S3 access policies  
✅ **Deploys Lambda**: Creates or updates the Lambda function  
✅ **Validates Setup**: Checks that everything is working correctly

## Quick Setup Commands

### Create IAM Role (if not exists)
```bash
# Create trust policy
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

# Create role
aws iam create-role \
  --role-name lambda-execution-role \
  --assume-role-policy-document file://trust-policy.json

# Attach policies
aws iam attach-role-policy \
  --role-name lambda-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Add S3 permissions (replace YOUR-BUCKET-NAME)
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

# Get the role ARN for GitHub secrets
aws iam get-role --role-name lambda-execution-role --query 'Role.Arn' --output text
```

## GitHub Secrets Summary

| Secret Name | Required | Example Value | How to Get |
|-------------|----------|---------------|------------|
| `AWS_ACCESS_KEY_ID` | ✅ **Required** | `AKIAIOSFODNN7EXAMPLE` | AWS Console → IAM → Users → Access keys |
| `AWS_SECRET_ACCESS_KEY` | ✅ **Required** | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` | AWS Console → IAM → Users → Access keys |
| `AWS_REGION` | Optional | `us-east-1` | Defaults to `us-east-1` |
| `LAMBDA_FUNCTION_NAME` | Optional | `my-photo-processor` | Defaults to `phot3s-upload-lambda` |

## Workflow Behavior

### On Pull Request:
- ✅ Runs tests and validation
- ❌ Does NOT deploy (safe for testing)

### On Push to Main:
- ✅ Runs tests and validation
- ✅ Deploys Lambda function
- ✅ Verifies deployment
- ❌ Does NOT configure S3 triggers (done via AWS Console)

## Post-Deployment Setup

After the GitHub Action deploys your Lambda:

### 1. Configure S3 Bucket Triggers (AWS Console)
1. Go to S3 → Your Bucket → Properties → Event notifications
2. Create notification with:
   - **Event types**: All object create events
   - **Destination**: Lambda function
   - **Lambda function**: `phot3s-upload-lambda`

### 2. Set Lambda Environment Variables (AWS Console)  
1. Go to Lambda → `phot3s-upload-lambda` → Configuration → Environment variables
2. Add variables as needed:
   - `ALLOWED_SOURCE_BUCKETS`: `bucket1,bucket2,bucket3`
   - `PROCESSED_BUCKET`: `my-processed-photos`
   - `PROCESSED_PREFIX`: `processed/`
   - `DELETE_ORIGINAL`: `false`

See [MULTI_BUCKET.md](MULTI_BUCKET.md) for detailed multi-bucket configuration.

## Security Best Practices

1. **Use IAM roles with minimal permissions**
2. **Don't use your root AWS account**
3. **Create a dedicated deployment user with only necessary permissions**
4. **Rotate access keys regularly**

### Recommended IAM Policy for Deployment User
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:UpdateFunctionCode",
        "lambda:GetFunction",
        "lambda:AddPermission",
        "iam:PassRole"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutBucketNotification",
        "s3:GetBucketNotification",
        "s3:HeadBucket"
      ],
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME"
    }
  ]
}
```

## Troubleshooting

### Common Issues:

**❌ "Access Denied" errors:**
- Check IAM permissions for deployment user
- Ensure role ARN is correct

**❌ "Function already exists" errors:**
- This is handled automatically by the workflow

**❌ "Bucket notification conflicts":**
- The workflow handles existing notifications gracefully

**❌ "Permission already exists" errors:**
- This is normal and handled by the workflow

### Viewing Workflow Logs:
1. Go to your repository on GitHub
2. Click "Actions" tab
3. Click on the latest workflow run
4. Click on job names to see detailed logs

## Testing the Setup

1. **Set up all GitHub secrets** (see table above)
2. **Make a small change** to any file
3. **Push to main branch:**
   ```bash
   echo "# Test deployment" >> README.md
   git add README.md
   git commit -m "Test automatic deployment"
   git push
   ```
4. **Watch the workflow** in GitHub Actions tab
5. **Verify deployment** in AWS Console

The workflow will automatically deploy your Lambda function every time you push to main! 🚀