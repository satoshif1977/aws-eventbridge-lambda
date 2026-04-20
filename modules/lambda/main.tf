# ── Lambda 関数 ─────────────────────────────────────────────

# ── IAM ロール（共通）──────────────────────────────────────
resource "aws_iam_role" "lambda" {
  name = "${var.project}-${var.env}-${var.function_name}-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

# CloudWatch Logs 書き込み権限
resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# 追加ポリシー（S3 / DynamoDB 等）
resource "aws_iam_role_policy" "custom" {
  count  = length(var.policy_statements) > 0 ? 1 : 0
  name   = "${var.project}-${var.env}-${var.function_name}-policy"
  role   = aws_iam_role.lambda.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = var.policy_statements
  })
}

# ── Lambda zip 作成 ────────────────────────────────────────
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/../../lambda_src/${var.function_name}.zip"
}

# ── Lambda 関数 ────────────────────────────────────────────
resource "aws_lambda_function" "this" {
  function_name    = "${var.project}-${var.env}-${var.function_name}"
  role             = aws_iam_role.lambda.arn
  handler          = "index.lambda_handler"
  runtime          = "python3.11"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = var.timeout
  memory_size      = var.memory_size

  environment {
    variables = var.environment_variables
  }

  tracing_config {
    mode = "PassThrough"
  }

  tags = var.tags
}

# ── CloudWatch Logs グループ ───────────────────────────────
resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${aws_lambda_function.this.function_name}"
  retention_in_days = 7
  tags              = var.tags
}
