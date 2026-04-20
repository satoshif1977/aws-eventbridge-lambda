# ── S3 バケット ────────────────────────────────────────────

# Pattern A: レポート保存用バケット
resource "aws_s3_bucket" "report" {
  bucket = "${var.project}-${var.env}-report-${var.account_id}"
  tags   = var.tags
}

resource "aws_s3_bucket_versioning" "report" {
  bucket = aws_s3_bucket.report.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "report" {
  bucket = aws_s3_bucket.report.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "report" {
  bucket                  = aws_s3_bucket.report.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "report" {
  bucket = aws_s3_bucket.report.id
  rule {
    id     = "expire-old-reports"
    status = "Enabled"
    filter {}
    expiration {
      days = 90 # 90日後に自動削除
    }
  }
}

# Pattern B: 処理トリガー用バケット（EventBridge 通知有効）
resource "aws_s3_bucket" "input" {
  bucket = "${var.project}-${var.env}-input-${var.account_id}"
  tags   = var.tags
}

resource "aws_s3_bucket_versioning" "input" {
  bucket = aws_s3_bucket.input.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "input" {
  bucket = aws_s3_bucket.input.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "input" {
  bucket                  = aws_s3_bucket.input.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "input" {
  bucket = aws_s3_bucket.input.id
  rule {
    id     = "expire-old-inputs"
    status = "Enabled"
    filter {}
    expiration {
      days = 30 # 30日後に自動削除
    }
  }
}

# EventBridge への S3 イベント通知を有効化
resource "aws_s3_bucket_notification" "input" {
  bucket      = aws_s3_bucket.input.id
  eventbridge = true
}
