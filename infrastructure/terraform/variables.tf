variable "aws_region" {
  type    = string
  default = "ap-southeast-1"
}

variable "project" {
  type    = string
  default = "football-app"
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "db_master_username" {
  type    = string
  default = "postgres"
}

variable "db_master_password" {
  type      = string
  sensitive = true
  # Không đặt default — truyền qua terraform.tfvars (không commit) hoặc AWS Secrets Manager
}

variable "db_name" {
  type    = string
  default = "football_app"
}
