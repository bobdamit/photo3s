# 🚀 Photo3s CI/CD Overview

## GitHub Actions Only - No Local Deployment

### **What You Have:**

```
photo3s/
├── handler
│   └── src
|   |   └── upload-lambda.js       # Your photo processing code
│   └── test
|   |   └── upload-lambda.test.js  # Unit test for handler
├── Dockerfile                     # Packages code into container
├── terraform/                     # Infrastructure definitions
│   ├── main.tf                    # AWS resources (Lambda, S3, etc.)
│   ├── dev.tfvars                 # Development settings
│   └── prod.tfvars                # Production settings
└── .github/workflows/             # Automation pipeline
    └── build-and-deploy.yml       # Complete CI/CD pipeline
```

### **The Workflow (Simplified):**

1. **You push code** → GitHub detects the change
2. **GitHub Actions runs** → Tests your code, builds container
3. **Terraform plans** → Shows what AWS resources will change
4. **If approved** → Creates/updates your AWS infrastructure
5. **Lambda deploys** → Your photo processing is live
6. **Upload photo** → Automatic processing begins!

### **Automated Deployment Only:**

```bash
git push origin feature-x    # → Runs test and builds container
git push origin main         # → Runs test builds/deployes container and applies terraform
```

### **What Happens When You Deploy:**

1. The Lambda is built into a docker container
2. The container is deployed to ECR
3. Terraform provisions/updates AWS resources includig buckets, roles, triggers

### **Environment Differences:**

| Environment | When Used | Settings |
|-------------|-----------|----------|
| **Dev** | Feature branches, testing | Smaller memory, keep originals, verbose logs |
| **Prod** | Main branch, real photos | More memory, delete originals, optimized |

### **Getting Started Checklist:**

- [ ] **Configure AWS credentials** in GitHub Secrets
- [ ] **Update bucket names** in terraform/*.tfvars files  
- [ ] **Set up GitHub environments** with approval rules
- [ ] **Push to feature branch** → Deploys to dev automatically
- [ ] **Upload test photo** → Check processed/ folder
- [ ] **Create PR to main** → Deploys to production
- [ ] **Monitor via GitHub Actions** and AWS CloudWatch

### **Daily Usage:**

```bash
# Make changes to your Lambda code
vim upload-lambda.js

# Create feature branch and push
git checkout -b my-improvement
git add . && git commit -m "Improve photo processing"
git push origin my-improvement
# → GitHub Actions automatically tests and deploys to dev

# Create pull request for production
gh pr create --title "Improve photo processing" --body "Ready for production"
# → GitHub Actions shows plan in PR comments

# Merge to main for production
gh pr merge --squash
# → GitHub Actions deploys to production (with approval)
```

### **Monitoring & Debugging:**

```bash
# View deployment status in GitHub
# Go to your repo → Actions tab

# Check Lambda logs (requires AWS CLI)
aws logs tail /aws/lambda/photo3s-dev-photo-processor --follow

# List processed photos
aws s3 ls s3://your-bucket-name/processed/ --recursive

# Or use AWS Console:
# CloudWatch → Log groups → /aws/lambda/photo3s-[env]-photo-processor
# S3 → Your bucket → processed/ folder
```

### **Cost & Safety:**

- **Development**: ~$1-5/month for testing
- **Production**: Depends on photo volume
- **Safety**: Each environment is isolated
- **Backups**: S3 versioning enabled by default
- **Monitoring**: CloudWatch alarms for errors

### **Getting Help:**

- **Setup issues**: Check GitHub Actions logs in Actions tab
- **Deployment errors**: Review Terraform plan in PR comments
- **CI/CD issues**: Check workflow logs in GitHub Actions
- **AWS errors**: Check CloudWatch logs in AWS Console
- **Infrastructure**: Read `TERRAFORM.md`
- **CI/CD details**: Read `GITHUB_ACTIONS.md`

This system gives you enterprise-grade photo processing with automated testing, deployment, and monitoring - all through GitHub Actions! 🎉