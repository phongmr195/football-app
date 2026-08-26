terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }

  # Chưa cấu hình remote state — bật khi có S3 bucket + DynamoDB lock table riêng cho state.
  # backend "s3" {
  #   bucket         = "football-app-terraform-state"
  #   key            = "dev/terraform.tfstate"
  #   region         = "ap-southeast-1"
  #   dynamodb_table = "football-app-terraform-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.aws_region
}
