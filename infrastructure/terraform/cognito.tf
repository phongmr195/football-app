resource "aws_cognito_user_pool" "main" {
  name = "${var.project}-${var.environment}"

  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = false
  }
}

resource "aws_cognito_user_pool_client" "mobile" {
  name         = "${var.project}-${var.environment}-mobile"
  user_pool_id = aws_cognito_user_pool.main.id

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH",
  ]

  generate_secret = false # mobile app dùng public client, không lưu secret trên máy
}
