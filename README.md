# Photo3s - Production Photo Processing Pipeline

**Modern, containerized AWS Lambda system for automated photo processing with GitHub Actions CI/CD.**

## What This Does

Automatically processes photos uploaded to S3 buckets:
- **Creates 5 sizes**: thumbnail (150px), small (400px), medium (800px), large (1920px), original
- **Extracts metadata**: EXIF, GPS, camera info, duplicate detection  
- **Smart renaming**: Uses actual photo date: `photo-2024-09-19_14-30-25-Canon.jpg`
- **Organized storage**: Structured folders with comprehensive JSON metadata
- **Production ready**: Error handling, monitoring, multi-environment support

## Architecture

- **AWS Lambda** (Node.js 20.x container) - Photo processing engine
- **Amazon S3** - Storage with event triggers  
- **Amazon ECR** - Container registry
- **Terraform** - Infrastructure as Code
- **GitHub Actions** - Automated CI/CD pipeline
- **CloudWatch** - Logging and monitoring

## File Structure Created

```
processed/
└── photo-2024-09-19_14-30-25-Canon/
    ├── photo-2024-09-19_14-30-25-Canon.jpg       # Original  
    ├── photo-2024-09-19_14-30-25-Canon_large.jpg # 1920px
    ├── photo-2024-09-19_14-30-25-Canon_medium.jpg# 800px
    ├── photo-2024-09-19_14-30-25-Canon_small.jpg # 400px
    ├── photo-2024-09-19_14-30-25-Canon_thumb.jpg # 150px
    └── photo-2024-09-19_14-30-25-Canon.json      # Metadata
```

## How to Deploy

**Zero local setup required!** Everything runs through GitHub Actions.

1. **Configure GitHub Secrets** (`Settings → Secrets → Actions`):
   ```
   AWS_ACCESS_KEY_ID
   AWS_SECRET_ACCESS_KEY  
   AWS_REGION
   ```

2. **Edit configuration** in `terraform/dev.tfvars`:
   ```hcl
   source_buckets = ["your-photos-dev-bucket"]
   lambda_memory = 512
   delete_original = false
   ```

3. **Deploy by pushing**:
   - Push to `develop` → deploys to dev environment
   - Push to `main` → deploys to prod (with approval gate)

## Project Structure

```
├── upload-lambda.js          # Lambda function code
├── Dockerfile               # Container definition  
├── terraform/              # Infrastructure as Code
│   ├── main.tf            # AWS resources
│   ├── dev.tfvars         # Development config
│   └── prod.tfvars        # Production config
├── .github/workflows/     # CI/CD pipeline
└── docs/
    ├── TERRAFORM.md       # Infrastructure details
    ├── GITHUB_ACTIONS.md  # Pipeline documentation
    └── QUICK_START.md     # Getting started guide
```

## Documentation

- **[QUICK_START.md](QUICK_START.md)** - Get up and running in 10 minutes
- **[GITHUB_ACTIONS.md](GITHUB_ACTIONS.md)** - CI/CD pipeline details  
- **[TERRAFORM.md](TERRAFORM.md)** - Infrastructure architecture

## Supported Formats

- JPEG (.jpg, .jpeg)
- PNG (.png)  
- TIFF (.tiff, .tif)
- WebP (.webp)

## Prerequisites

- AWS account with programmatic access
- GitHub repository with Actions enabled  
- S3 bucket for photo uploads

## Monitoring

After deployment, monitor your system through:

- **GitHub Actions** - Pipeline status and deployment logs
- **AWS CloudWatch** - Lambda execution logs and metrics  
- **AWS Console** - S3 bucket contents and processed files

## Contributing

1. Create feature branch
2. Push to `develop` for testing
3. Merge to `main` for production deployment (requires approval)

---

*This project uses modern DevOps practices with Infrastructure as Code and automated CI/CD for reliable, scalable photo processing.*