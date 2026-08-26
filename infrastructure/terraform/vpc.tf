data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.project}-${var.environment}"
  }
}

# 2 private subnet ở 2 AZ khác nhau — bắt buộc cho Aurora DB subnet group.
# Chưa có NAT/IGW ở bản MVP này để giảm chi phí; Lambda truy cập Aurora qua VPC endpoint
# hoặc Aurora Data API — cần bổ sung NAT khi có nhu cầu gọi ra internet từ trong VPC.
resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "${var.project}-${var.environment}-private-${count.index}"
  }
}

resource "aws_db_subnet_group" "aurora" {
  name       = "${var.project}-${var.environment}-aurora"
  subnet_ids = aws_subnet.private[*].id
}
