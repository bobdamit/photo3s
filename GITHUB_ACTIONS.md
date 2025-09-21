# GitHub Actions CI/CD Setup Guide

This guide explains how to set up CI/CD for your photo processing infrastructure using GitHub Actions with Terraform.

## 🔄 **How the CI/CD Works**

### **Workflow Triggers**
- **Push to `main`** → Deploys to production
- **Push to other branches** → Deploys to dev environment  
- **Pull Requests** → Plans changes (doesn't deploy)
- **Manual trigger** → Choose environment and action

### **Pipeline Stages**

```mermaid
graph TD
    A[Code Push] --> B[Test Lambda Code]
    B --> C[Build Docker Image]
    C --> D[Terraform Plan]
    D --> E{Is Main Branch?}
    E -->|Yes| F[Deploy to Production]
    E -->|No| G[Deploy to Dev]
    F --> H[Run Smoke Tests]
    G --> H
    H --> I[Update GitHub Environment]
```

## 🛠 **Setup Steps**

### **1. Configure GitHub Secrets**

Go to your repository → Settings → Secrets and variables → Actions

**Required Secrets:**
```
AWS_ACCESS_KEY_ID     = your-aws-access-key
AWS_SECRET_ACCESS_KEY = your-aws-secret-key
```

**Optional Variables:**
```
AWS_REGION = us-east-1  (default)
```

### **2. Create GitHub Environments**

Go to Settings → Environments and create:

- **`dev`** - Development environment (auto-deploy)
- **`staging`** - Staging environment (manual approval)  
- **`prod`** - Production environment (manual approval + branch protection)
- **`dev-destroy`** - For manual infrastructure destruction
- **`prod-destroy`** - For manual infrastructure destruction

**Environment Settings:**
- **Protection rules**: Require manual approval for prod
- **Environment secrets**: Environment-specific overrides if needed
- **Reviewers**: Add team members who can approve deployments

### **3. Configure Branch Protection (Recommended)**

Settings → Branches → Add rule for `main`:
- ✅ Require pull request reviews
- ✅ Require status checks (select the test job)
- ✅ Require branches to be up to date
- ✅ Include administrators

## 🚀 **Usage Examples**

### **Development Workflow**
```bash
# 1. Create feature branch
git checkout -b feature/new-enhancement

# 2. Make changes to Lambda or Terraform
vim upload-lambda.js
vim terraform/dev.tfvars

# 3. Commit and push
git add .
git commit -m "Add new enhancement"
git push origin feature/new-enhancement

# 4. GitHub Actions automatically:
#    - Tests your code
#    - Builds Docker image  
#    - Deploys to DEV environment
```

### **Production Deployment**
```bash
# 1. Create PR to main
gh pr create --title "Deploy new enhancement" --body "Ready for production"

# 2. GitHub Actions runs plan and comments on PR

# 3. After review and approval, merge PR
gh pr merge --squash

# 4. GitHub Actions automatically:
#    - Deploys to PRODUCTION
#    - Requires manual approval (if configured)
#    - Runs smoke tests
```

### **Manual Operations**
```bash
# Manual deployment via GitHub UI:
# 1. Go to Actions tab
# 2. Select "Deploy Photo3s Infrastructure"
# 3. Click "Run workflow"
# 4. Choose:
#    - Environment: dev/staging/prod
#    - Action: plan/apply/destroy
```
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