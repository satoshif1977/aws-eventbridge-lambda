# ── Pattern C: EventBridge Pipes ────────────────────────────
# SQS → フィルター（size > 0）→ エンリッチメント Lambda → Processor Lambda
# 1リソース（aws_pipes_pipe）でフィルター・変換・ルーティングを完結させる

# ── SQS キュー（Pipes のソース）─────────────────────────────
resource "aws_sqs_queue" "source" {
  name                       = "${var.project}-${var.env}-pipe-source"
  message_retention_seconds  = 86400 # 1日
  visibility_timeout_seconds = 60    # Lambda タイムアウト + 余裕
  # SQS マネージド SSE（保存データの暗号化 / CKV_AWS_27）
  sqs_managed_sse_enabled = true

  tags = var.tags
}

# ── IAM ロール（Pipes が SQS 読み取り・Lambda 呼び出しに使用）──
resource "aws_iam_role" "pipe" {
  name = "${var.project}-${var.env}-pipe-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "pipes.amazonaws.com" }
        Action    = "sts:AssumeRole"
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "pipe" {
  name = "${var.project}-${var.env}-pipe-policy"
  role = aws_iam_role.pipe.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # SQS 読み取り・削除（Pipes がポーリングに使用）
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ]
        Resource = aws_sqs_queue.source.arn
      },
      # エンリッチメント Lambda 呼び出し
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = var.enricher_lambda_arn
      },
      # ターゲット Lambda 呼び出し
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = var.processor_lambda_arn
      },
    ]
  })
}

# ── EventBridge Pipe 本体 ────────────────────────────────────
resource "aws_pipes_pipe" "this" {
  name     = "${var.project}-${var.env}-s3-enriched-pipe"
  role_arn = aws_iam_role.pipe.arn

  # ソース: SQS キュー
  source = aws_sqs_queue.source.arn
  source_parameters {
    sqs_queue_parameters {
      batch_size                         = 1
      maximum_batching_window_in_seconds = 0
    }
    # フィルター: size > 0 のメッセージのみ通過（空ファイルを除外）
    filter_criteria {
      filter {
        pattern = jsonencode({
          body = {
            size = [{ numeric = [">", 0] }]
          }
        })
      }
    }
  }

  # エンリッチメント: ファイル種別・優先度を付与する Lambda
  enrichment = var.enricher_lambda_arn
  enrichment_parameters {
    # SQS body（JSON 文字列）を展開して enricher に渡す
    input_template = "<$.body>"
  }

  # ターゲット: 既存の Processor Lambda
  target = var.processor_lambda_arn
  target_parameters {
    # enricher の戻り値をそのまま processor の event として渡す
    input_template = "<$.body>"
  }

  tags = var.tags
}
