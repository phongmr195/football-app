# Aurora Serverless v2 — scale-to-zero-ish, phù hợp giai đoạn chưa có traffic ổn định.
# Xem docs/architecture/PROJECT_PLAN.md § 7.1 (nguyên tắc không dựng full-size infra từ đầu).

resource "aws_security_group" "aurora" {
  name        = "${var.project}-${var.environment}-aurora"
  description = "Cho phép Lambda/API trong VPC kết nối Aurora Postgres"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.main.cidr_block]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_rds_cluster" "aurora" {
  cluster_identifier     = "${var.project}-${var.environment}"
  engine                 = "aurora-postgresql"
  engine_mode            = "provisioned"
  engine_version         = "15.4"
  database_name          = var.db_name
  master_username        = var.db_master_username
  master_password        = var.db_master_password
  db_subnet_group_name   = aws_db_subnet_group.aurora.name
  vpc_security_group_ids = [aws_security_group.aurora.id]
  skip_final_snapshot    = true # bật lại khi lên production

  serverlessv2_scaling_configuration {
    min_capacity = 0.5
    max_capacity = 2
  }
}

resource "aws_rds_cluster_instance" "aurora" {
  cluster_identifier = aws_rds_cluster.aurora.id
  instance_class      = "db.serverless"
  engine              = aws_rds_cluster.aurora.engine
  engine_version      = aws_rds_cluster.aurora.engine_version
}
