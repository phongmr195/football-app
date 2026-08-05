output "aurora_endpoint" {
  value = aws_rds_cluster.aurora.endpoint
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.mobile.id
}

output "assets_bucket_name" {
  value = aws_s3_bucket.assets.bucket
}
