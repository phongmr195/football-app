output "aurora_endpoint" {
  value = aws_rds_cluster.aurora.endpoint
}

output "assets_bucket_name" {
  value = aws_s3_bucket.assets.bucket
}
