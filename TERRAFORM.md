# Photo3s Infrastructure

Production-ready infrastructure for automated photo processing using AWS Lambda, S3, and containerized deployments managed through GitHub Actions CI/CD pipeline.

## Architecture

- **AWS Lambda**: Containerized photo processing function (Node.js 20.x)
- **Amazon S3**: Source and processed photo storage with event triggers
- **Amazon ECR**: Container image registry for Lambda deployments
- **CloudWatch**: Comprehensive logging, monitoring, and alerting
- **Terraform**: Infrastructure as Code with multi-environment support
- **GitHub Actions**: Automated CI/CD pipeline for building and deploying

## Features

- Multi-size image generation (thumbnail, small, medium, large, original)
- EXIF metadata extraction and GPS data processing
- Intelligent duplicate detection using date-based searching
- Configurable duplicate handling (delete/move/keep)
- Comprehensive error handling and retry logic
- Memory usage monitoring and optimization
- Multi-environment support (dev/staging/prod)
- Automated CI/CD pipeline with approval gates

## Prerequisites

- **AWS Account** with programmatic access
- **GitHub Repository** with Actions enabled
- **Terraform Cloud** or **AWS S3** for state management (optional but recommended)

## Quick Start with GitHub Actions

### 1. Configure GitHub Secrets

Add these secrets to your GitHub repository (`Settings` → `Secrets and variables` → `Actions`):

```
AWS_ACCESS_KEY_ID     # AWS access key with sufficient permissions
AWS_SECRET_ACCESS_KEY # AWS secret access key
AWS_REGION           # AWS region (e.g., us-east-1)
```

### 2. Configure Environment Variables

Edit the environment-specific variables in `terraform/dev.tfvars`:

```hcl
# Development environment configuration
environment = "dev"
aws_region  = "us-east-1"

# S3 Configuration - CHANGE THESE TO YOUR BUCKET NAMES
source_buckets = ["your-photos-dev-bucket"]
create_buckets = true

# Lambda Configuration
lambda_memory  = 512
lambda_timeout = 60
delete_original = false  # Keep originals in dev

# Monitoring
enable_monitoring = true
enable_xray      = true
log_retention_days = 7
```

### 3. Deploy via GitHub Actions

The CI/CD pipeline automatically triggers when you:

- **Push to `develop` branch** → Deploys to development environment
- **Push to `main` branch** → Deploys to production environment (with approval gate)

```bash
# Deploy to development
git checkout develop
git add .
git commit -m "Update infrastructure configuration"
git push origin develop

# Deploy to production
git checkout main
git merge develop
git push origin main
# → Requires manual approval in GitHub Actions interface
```

### 4. Monitor Deployment

**View GitHub Actions Progress:**
- Go to your repository's `Actions` tab
- Monitor the `Deploy Infrastructure` workflow
- Review Terraform plan before approval (for production)

**Check AWS Resources:**
```bash
# View Lambda logs
aws logs tail /aws/lambda/photo3s-dev-photo-processor --follow

# Check ECR repository
aws ecr describe-repositories --repository-names photo3s-dev-lambda

# List processed files
aws s3 ls s3://your-photos-dev-bucket/processed/ --recursive
```

## ECR and Container Workflow

### ECR Repository

Terraform automatically creates an ECR repository for each environment:

```hcl
resource "aws_ecr_repository" "lambda_repo" {
  name = "${var.project_name}-${var.environment}-lambda"  # e.g., "photo3s-dev-lambda"
  image_tag_mutability = "MUTABLE"
  force_delete = true
}
```

**Repository naming pattern:**
- Development: `photo3s-dev-lambda`
- Production: `photo3s-prod-lambda`

### Docker Container Build

The GitHub Actions pipeline handles all container operations:

1. **Build Phase** (in GitHub Actions):
   ```yaml
   - name: Build Docker image
     run: |
       docker build -t $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG .
       docker tag $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG $ECR_REGISTRY/$ECR_REPOSITORY:latest
   ```

2. **Push Phase**:
   ```yaml
   - name: Push to ECR
     run: |
       docker push $ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG
       docker push $ECR_REGISTRY/$ECR_REPOSITORY:latest
   ```

3. **Lambda Deployment**:
   - Terraform references the latest image from ECR
   - Lambda function automatically uses the new container image
   - Zero-downtime deployment with gradual rollout

### Container Image Details

**Base Image:** `public.ecr.aws/lambda/nodejs:20`
**Dependencies:** Sharp (compiled for Lambda runtime), AWS SDK v3
**Size:** ~150MB (optimized with multi-stage build)
**Scanning:** Automatic vulnerability scanning enabled

## Configuration

### Environment Variables

Lambda function supports these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PROCESSED_BUCKET` | source bucket | Target bucket for processed files |
| `PROCESSED_PREFIX` | `processed/` | Prefix for processed files |
| `DELETE_ORIGINAL` | `true` | Delete original after processing |
| `CHECK_DUPLICATES` | `true` | Enable duplicate detection |
| `DUPLICATE_ACTION` | `move` | Action for duplicates: `delete`/`move`/`keep` |
| `DUPLICATES_PREFIX` | `duplicates/` | Prefix for duplicate files |
| `MAX_FILE_SIZE` | `104857600` | Max file size in bytes (100MB) |
| `OPERATION_TIMEOUT` | `30000` | Timeout for operations in ms |
| `DETAILED_LOGGING` | `false` | Enable verbose logging |

### Terraform Variables

Key variables in `terraform/*.tfvars`:

| Variable | Type | Description |
|----------|------|-------------|
| `source_buckets` | list | S3 buckets that trigger processing |
| `create_buckets` | bool | Whether to create the buckets |
| `processed_bucket_name` | string | Separate processed bucket (optional) |
| `lambda_memory` | number | Lambda memory in MB (128-10240) |
| `lambda_timeout` | number | Lambda timeout in seconds (1-900) |
| `enable_monitoring` | bool | Enable CloudWatch alarms |
| `enable_xray` | bool | Enable X-Ray tracing |
| `log_retention_days` | number | CloudWatch log retention |

## Monitoring and Operations

### GitHub Actions Monitoring

**Deployment Pipeline Status:**
- Monitor workflow runs in the `Actions` tab
- Review Terraform plans before approvals
- Check build logs for container creation
- Validate deployment success/failure

**Pipeline Stages:**
1. **Validate** - Terraform syntax and formatting
2. **Plan** - Show infrastructure changes
3. **Build** - Create and push Docker container to ECR
4. **Deploy** - Apply Terraform changes (requires approval for prod)
5. **Verify** - Run basic functionality tests

### CloudWatch Alarms

Automatically created alarms for each environment:

- **Lambda Errors** - Triggers on > 5 errors in 5 minutes
- **Lambda Duration** - Alerts when > 80% of timeout threshold
- **Lambda Throttles** - Immediate alert on any throttling
- **ECR Image Vulnerabilities** - Weekly scan results

### Accessing Logs

**Via AWS CLI:**
```bash
# Real-time logs
aws logs tail /aws/lambda/photo3s-[env]-photo-processor --follow

# Filter by error level
aws logs filter-log-events \
  --log-group-name /aws/lambda/photo3s-[env]-photo-processor \
  --filter-pattern "ERROR"
```

**Via AWS Console:**
1. Navigate to CloudWatch → Log Groups
2. Select `/aws/lambda/photo3s-[env]-photo-processor`
3. Use CloudWatch Insights for advanced queries

### Key Metrics Dashboard

Monitor these CloudWatch metrics:

- **AWS/Lambda/Duration** - Processing time per photo
- **AWS/Lambda/Errors** - Error count and rate
- **AWS/Lambda/Invocations** - Total processing requests
- **AWS/Lambda/Throttles** - Rate limiting events
- **AWS/S3/BucketSizeBytes** - Storage growth
- **ECR Repository** - Image push frequency and vulnerabilities

## Photo Processing Pipeline

### Input
- Supported formats: JPG, JPEG, PNG, TIFF, TIF, WEBP
- Maximum file size: 100MB (configurable)
- Triggers on S3 ObjectCreated events

### Processing
1. **Download**: Retrieve original from S3 with retry logic
2. **Validation**: Check file size, format, and source bucket
3. **EXIF Extraction**: Parse metadata, GPS, camera info
4. **Duplicate Detection**: Compare with existing photos using date-based search
5. **Image Processing**: Create 5 sizes with Sharp
6. **Upload**: Store all versions and metadata in organized folders
7. **Cleanup**: Optionally delete original file

### Output Structure
```
processed/
└── photo-2025-01-15_14-30-22-Canon/
    ├── photo-2025-01-15_14-30-22-Canon.jpg      # Original
    ├── photo-2025-01-15_14-30-22-Canon_large.jpg # 1920x1920
    ├── photo-2025-01-15_14-30-22-Canon_medium.jpg# 800x800
    ├── photo-2025-01-15_14-30-22-Canon_small.jpg # 400x400
    ├── photo-2025-01-15_14-30-22-Canon_thumb.jpg # 150x150
    └── photo-2025-01-15_14-30-22-Canon.json      # Metadata
```

### Metadata Format
```json
{
  "status": "processed",
  "originalKey": "DSCF8545.jpg",
  "newBaseName": "photo-2025-01-15_14-30-22-Canon",
  "timestamp": "2025-01-15T14:30:22.000Z",
  "camera": "Canon",
  "fileSize": 8245760,
  "originalDimensions": {
    "width": 4000,
    "height": 3000,
    "format": "jpeg"
  },
  "exifData": {
    "make": "Canon",
    "model": "EOS R5",
    "dateTimeOriginal": "2025-01-15T14:30:22.000Z",
    "iso": 100,
    "fNumber": 2.8,
    "gps": {
      "latitude": 37.7749,
      "longitude": -122.4194
    }
  },
  "versions": {
    "original": "processed/photo-2025-01-15_14-30-22-Canon/photo-2025-01-15_14-30-22-Canon.jpg",
    "large": "processed/photo-2025-01-15_14-30-22-Canon/photo-2025-01-15_14-30-22-Canon_large.jpg",
    "medium": "processed/photo-2025-01-15_14-30-22-Canon/photo-2025-01-15_14-30-22-Canon_medium.jpg",
    "small": "processed/photo-2025-01-15_14-30-22-Canon/photo-2025-01-15_14-30-22-Canon_small.jpg",
    "thumb": "processed/photo-2025-01-15_14-30-22-Canon/photo-2025-01-15_14-30-22-Canon_thumb.jpg"
  }
}
```

## Troubleshooting

### GitHub Actions Issues

**1. Pipeline fails at Docker build**
- Check Dockerfile syntax and dependencies
- Verify base image availability
- Review build logs in Actions tab

```yaml
# Check GitHub Actions logs for:
# - Docker build context issues
# - Missing files or dependencies  
# - ECR authentication failures
```

**2. Terraform plan/apply failures**
- Verify AWS credentials in GitHub Secrets
- Check IAM permissions for Terraform operations
- Review state file conflicts

```bash
# Verify AWS credentials match GitHub Actions setup
# Check your GitHub Secrets configuration instead
aws sts get-caller-identity
```

**3. ECR push failures**
- Check ECR repository exists (created by Terraform)
- Verify AWS credentials have ECR push permissions
- Review GitHub Actions logs for authentication errors

### Lambda Runtime Issues

**1. Lambda timeout errors**
- Increase `lambda_timeout` in tfvars (max 900 seconds)
- Monitor CloudWatch metrics for duration trends
- Check logs for specific timeout locations

**2. Memory issues**
- Increase `lambda_memory` in tfvars (128-10240 MB)
- Reduce `MAX_FILE_SIZE` environment variable
- Monitor CloudWatch memory utilization metrics

**3. S3 permission errors**
- Verify bucket names match tfvars configuration
- Check Lambda IAM role has correct S3 permissions
- Ensure buckets exist or `create_buckets = true`

### Debugging Steps

**1. Check GitHub Actions Status**
```bash
# View recent workflow runs
gh run list --limit 10

# View specific run details
gh run view [RUN_ID]
```

**2. Validate Terraform Configuration**
```bash
# View recent workflow runs
gh run list --limit 10

# View specific run details  
gh run view [RUN_ID]

# Check Terraform formatting in GitHub Actions
# (validation happens automatically in pipeline)
```

**3. Monitor Lambda Execution**
```bash
# Real-time monitoring
aws logs tail /aws/lambda/photo3s-[env]-photo-processor --follow

# Check recent errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/photo3s-[env]-photo-processor \
  --filter-pattern "ERROR" \
  --start-time $(date -d "1 hour ago" +%s)000
```

## Security Considerations

- Lambda execution role follows least privilege principle
- S3 buckets use server-side encryption (AES256)
- Container images are scanned for vulnerabilities
- CloudWatch logs have configurable retention periods
- No sensitive data in environment variables or logs

## Cost Optimization

- Use lifecycle policies to transition old duplicates to cheaper storage
- Configure appropriate log retention periods
- Right-size Lambda memory allocation
- Consider Reserved Capacity for predictable workloads
- Monitor costs with AWS Cost Explorer

## Contributing

### Development Workflow

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-enhancement
   ```

2. **Make Infrastructure Changes**
   - Update Terraform configurations in `terraform/`
   - Modify environment variables in `*.tfvars` files
   - Update Lambda code if needed

3. **Test in Development**
   ```bash
   # Push to development environment
   git checkout develop
   git merge feature/your-enhancement
   git push origin develop
   # → Automatically deploys to dev environment
   ```

4. **Validate Changes**
   - Monitor GitHub Actions workflow
   - Review Terraform plan output
   - Test functionality in dev environment
   - Check CloudWatch logs and metrics

5. **Deploy to Production**
   ```bash
   # Merge to main for production deployment
   git checkout main
   git merge develop
   git push origin main
   # → Requires manual approval in GitHub Actions
   ```

### Best Practices

- Always test changes in development first
- Use meaningful commit messages and PR descriptions
- Review Terraform plans carefully before approval
- Update documentation for infrastructure changes
- Follow semantic versioning for releases
- Monitor deployments and rollback if issues occur

## Support

### Getting Help

**GitHub Actions Issues:**
1. Check the `Actions` tab for workflow run details
2. Review build logs and Terraform plans
3. Verify GitHub Secrets configuration

**AWS Infrastructure Issues:**
1. Monitor CloudWatch logs and metrics
2. Check AWS service health dashboard
3. Verify IAM permissions and resource limits

**Lambda Function Issues:**
1. Review CloudWatch logs for specific errors
2. Check function timeout and memory settings
3. Validate S3 bucket configurations and permissions

### Resources

- **GitHub Actions Documentation**: [GitHub Actions Docs](https://docs.github.com/en/actions)
- **Terraform AWS Provider**: [Terraform AWS Docs](https://registry.terraform.io/providers/hashicorp/aws/latest)
- **AWS Lambda Container Images**: [AWS Lambda Docs](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)
- **ECR User Guide**: [Amazon ECR Docs](https://docs.aws.amazon.com/ecr/)