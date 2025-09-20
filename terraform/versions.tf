terraform {
  required_version = ">= 1.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }

  # Optional: Configure remote state
  # backend "s3" {
  #   bucket = "your-terraform-state-bucket"
  #   key    = "photo3s/terraform.tfstate"
  #   region = "us-east-1"
  # }
}