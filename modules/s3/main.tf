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

# EventBridge への S3 イベント通知を有効化
resource "aws_s3_bucket_notification" "input" {
  bucket      = aws_s3_bucket.input.id
  eventbridge = true
}
