terraform {
  required_version = ">= 1.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.14.0"
    }
    docker = {
      source  = "docker/docker"
      version = "~> 0.5.2"
    }
  }

  # Optional: Configure remote state
  # backend "s3" {
  #   bucket = "your-terraform-state-bucket"
  #   key    = "photo3s/terraform.tfstate"
  #   region = "us-east-1"
  # }
}