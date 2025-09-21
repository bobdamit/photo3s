terraform {
  required_version = ">= 1.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.14.0"
    }
  }

  # S3 Backend for remote state management
  backend "s3" {
    bucket = "photo3s-dev-terraform-state"
    key    = "terraform.tfstate"
    region = "us-east-1"
  }
}