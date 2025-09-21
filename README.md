# Photo3s - Production Photo Processing Pipeline

**Modern, containerized AWS Lambda system for automated photo processing with GitHub Actions CI/CD and paired bucket architecture.**

## What This Does

Automatically processes photos uploaded to S3 ingress buckets and delivers them to dedicated processed buckets:
- **Creates 5 sizes**: thumb , small , medium , large , original
- **WebP conversion**: Processed variants use efficient WebP format (25-35% smaller than JPEG)
- **Extracts metadata**: EXIF with GPS coordinates, camera settings, duplicate detection  
- **Smart renaming**: Uses actual photo date: `photo-2024-09-19_14-30-25-Canon.jpg`
- **Paired bucket architecture**: Separate ingress → processed bucket workflow
- **Public photo serving**: Processed buckets configured for direct web access
- **Clean organization**: Photos stored directly at bucket root level
- **Production ready**: Error handling, monitoring, multi-environment support

## Architecture

- **AWS Lambda** (Node.js 20.x container) - Photo processing engine
- **Amazon S3** - Paired bucket storage (ingress + processed) with event triggers  
- **Amazon ECR** - Container registry (managed by CI/CD)
- **Terraform** - Infrastructure as Code
- **GitHub Actions** - Four-job CI/CD pipeline (test → build → container → infrastructure)
- **CloudWatch** - Logging and monitoring

## Paired Bucket System

### Development Environment
- **Ingress buckets**: `photo3s-dev-sailing-ingress`, `photo3s-dev-mics-ingress`
- **Processed buckets**: `photo3s-dev-sailing-processed`, `photo3s-dev-mics-processed`

Photos uploaded to ingress buckets are automatically processed and organized in corresponding processed buckets with public read access for direct web serving.

## File Structure Created

**New clean structure** (no unnecessary subfolders):
```
photo3s-prod-bucketname-processed/
└── photo-2024-09-19_14-30-25-Canon/
    ├── DSC00334455.jpg  # Original (preserved)
    ├── large.webp       # 1920px (WebP)
    ├── medium.webp      # 1200px (WebP)
    ├── small.webp       # 450px (WebP)
    ├── thumb.webp       # 200px (WebP)
    └── metadata.json    # Metadata
```

**Direct web access URLs**:
```
https://photo3s-prod-bucketname-processed.s3.amazonaws.com/photo-key/large.webp
```

## How to Deploy

**Zero local setup required!** Everything runs through GitHub Actions with a four-job pipeline.

### Prerequisites Setup

1. **Configure GitHub Secrets** (`Settings → Secrets → Actions`):
   ```
   AWS_ACCESS_KEY_ID
   AWS_SECRET_ACCESS_KEY  
   AWS_REGION
   ```

2. **Configure bucket pairs** in `terraform/dev.tfvars`:
   ```hcl
   # Each root creates ingress + processed bucket pair
   bucket_prefix = "photo3s"
   bucket_roots  = ["sailing", "mics"]  # Creates 4 buckets total
   lambda_memory = 512
   ```

3. **Deploy via GitHub Actions**:
   - **Push to `modernize-cicd`** → deploys with four-job pipeline:
     1. **Build Job** → Tests and builds Lambda code  
     2. **Deploy Container** → Creates ECR repo, builds and pushes Docker image
     3. **Deploy Infrastructure** → Applies Terraform with pre-built image

### Pipeline Jobs

The deployment pipeline has been optimized into three sequential jobs:

1. **`build`** - Node.js testing and validation
2. **`deploy-container`** - ECR repository creation and Docker image deployment  
3. **`deploy-infrastructure`** - Terraform deployment using pre-built container image

This architectural separation ensures:
- **Container lifecycle** managed by CI/CD (GitHub Actions)
- **Infrastructure lifecycle** managed by Terraform
- **No resource conflicts** between container and infrastructure management
- **Faster deployments** with pre-built images

## Project Structure

```
├── upload-lambda.js           # Lambda function code with smart bucket detection
├── Dockerfile                # Container definition for Lambda deployment
├── package.json              # Node.js dependencies (Sharp, EXIF parser)
├── terraform/                # Infrastructure as Code
│   ├── main.tf               # AWS resources (S3, Lambda, IAM, ECR)
│   ├── dev.tfvars            # Development config (bucket pairs)  
│   ├── prod.tfvars           # Production config
│   ├── variables.tf          # Terraform input variables
│   ├── outputs.tf            # Terraform outputs
│   └── versions.tf           # S3 backend configuration
├── .github/workflows/        # Four-job CI/CD pipeline
│   └── build-and-deploy.yml  # Build → Container → Infrastructure jobs
├── cleanup-aws-resources.sh  # Resource cleanup utility
├── create-terraform-state-bucket.sh  # S3 backend setup
└── docs/                     # Comprehensive documentation
    ├── TERRAFORM.md          # Infrastructure details
    ├── GITHUB_ACTIONS.md     # Pipeline documentation  
    ├── PIPELINE_ARCHITECTURE.md  # Three-job workflow design
    └── QUICK_START.md        # Getting started guide
```

## Key Features

### Intelligent Bucket Routing
- **Paired bucket architecture**: Automatic routing from ingress → processed buckets
- **Smart folder structure**: No unnecessary subfolders in dedicated processed buckets
- **Backward compatibility**: Falls back to single-bucket mode with `processed/` prefix

### Public Access Configuration  
- **Direct web serving**: Processed buckets configured for public GetObject access
- **Security controls**: Ingress buckets remain private, processed buckets public
- **CDN ready**: Optimized for CloudFront distribution integration

### Advanced Processing Features
- **Duplicate detection**: EXIF-based duplicate identification with GPS coordinate extraction
- **Memory optimization**: Streaming processing with memory monitoring
- **Retry logic**: Resilient uploads with exponential backoff
- **Multiple output formats**: 5 different sizes plus original with GPS-enhanced metadata

## Documentation

- **[QUICK_START.md](QUICK_START.md)** - Get up and running in 10 minutes
- **[GITHUB_ACTIONS.md](GITHUB_ACTIONS.md)** - Four-job CI/CD pipeline details  
- **[PIPELINE_ARCHITECTURE.md](PIPELINE_ARCHITECTURE.md)** - Build → Container → Infrastructure workflow
- **[TERRAFORM.md](TERRAFORM.md)** - Infrastructure architecture and paired bucket design

## Supported Formats

**Input formats** (for upload):
- JPEG (.jpg, .jpeg)
- PNG (.png)  
- TIFF (.tiff, .tif)
- WebP (.webp)

**Output formats**:
- Original file: Preserved in original format
- Processed variants: WebP format (25-35% smaller than JPEG)

## Configuration

### Environment Variables (Terraform managed)
- **`BUCKET_MAPPINGS`** - JSON mapping of ingress → processed buckets
- **`ALLOWED_SOURCE_BUCKETS`** - Comma-separated list of allowed ingress buckets
- **`CHECK_DUPLICATES`** - Enable duplicate detection (default: true)
- **`DUPLICATE_ACTION`** - What to do with duplicates: 'delete', 'move', 'replace' (default: replace)

### Bucket Configuration (dev.tfvars)
```hcl
bucket_prefix = "photo3s"
bucket_roots  = ["sailing", "mics"]  # Creates paired buckets for each root
create_buckets = true                 # Set to false to reference existing buckets
lambda_memory = 512                   # Lambda memory allocation (MB)
```

## Monitoring and Logs

After deployment, monitor your system through:

- **GitHub Actions** - Pipeline status, four-job execution logs
- **AWS CloudWatch** - Lambda execution logs, error tracking, performance metrics  
- **AWS Console** - S3 bucket contents, processed file organization
- **ECR Console** - Container image versions and deployment history

## Clean Deployment

The system supports complete clean deployment from scratch:

1. **Resource Cleanup** - `./cleanup-aws-resources.sh` removes all AWS resources
2. **State Management** - S3 backend with versioned state file storage  
3. **Fresh Deployment** - GitHub Actions creates everything from zero state

## Contributing

1. Create feature branch from `my-slick-new-feature`
2. Test changes with four-job pipeline
3. Deploy to production environment as needed

---

*This project demonstrates modern DevOps practices with Infrastructure as Code, containerized Lambda deployment, and sophisticated CI/CD pipeline architecture for reliable, scalable photo processing.*