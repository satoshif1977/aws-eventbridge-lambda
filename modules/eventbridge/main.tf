# ── EventBridge ルール ──────────────────────────────────────

# ── Pattern A: スケジュール実行ルール ──────────────────────
resource "aws_cloudwatch_event_rule" "scheduler" {
  name                = "${var.project}-${var.env}-daily-scheduler"
  description         = "毎日 9:00 JST に Lambda を起動して日次レポートを生成する"
  schedule_expression = "cron(0 0 * * ? *)" # UTC 0:00 = JST 9:00
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "scheduler" {
  rule      = aws_cloudwatch_event_rule.scheduler.name
  target_id = "SchedulerLambda"
  arn       = var.scheduler_lambda_arn
}

# EventBridge → Lambda 実行権限
resource "aws_lambda_permission" "scheduler" {
  statement_id  = "AllowEventBridgeScheduler"
  action        = "lambda:InvokeFunction"
  function_name = var.scheduler_lambda_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.scheduler.arn
}

# ── Pattern B: S3 イベント駆動ルール ───────────────────────
resource "aws_cloudwatch_event_rule" "s3_trigger" {
  name        = "${var.project}-${var.env}-s3-object-created"
  description = "S3 バケットへのオブジェクト作成を検知して Lambda を起動する"
  tags        = var.tags

  event_pattern = jsonencode({
    source      = ["aws.s3"]
    detail-type = ["Object Created"]
    detail = {
      bucket = {
        name = [var.input_bucket_name]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "s3_trigger" {
  rule      = aws_cloudwatch_event_rule.s3_trigger.name
  target_id = "ProcessorLambda"
  arn       = var.processor_lambda_arn
}

# EventBridge → Lambda 実行権限
resource "aws_lambda_permission" "s3_trigger" {
  statement_id  = "AllowEventBridgeS3Trigger"
  action        = "lambda:InvokeFunction"
  function_name = var.processor_lambda_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.s3_trigger.arn
}
