terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.44"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

locals {
  tags = {
    Project     = var.project
    Environment = var.env
    ManagedBy   = "Terraform"
  }
}

# ── S3 モジュール ──────────────────────────────────────────
module "s3" {
  source     = "../../modules/s3"
  project    = var.project
  env        = var.env
  account_id = data.aws_caller_identity.current.account_id
  tags       = local.tags
}

# ── DynamoDB（Pattern B: 処理結果記録）─────────────────────
resource "aws_dynamodb_table" "processed_files" {
  name         = "${var.project}-${var.env}-processed-files"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true

  tags = local.tags
}

# ── Lambda: scheduler（Pattern A）────────────────────────
module "lambda_scheduler" {
  source        = "../../modules/lambda"
  project       = var.project
  env           = var.env
  function_name = "scheduler"
  source_dir    = "../../lambda_src/scheduler"
  timeout       = 30
  tags          = local.tags

  environment_variables = {
    REPORT_BUCKET_NAME = module.s3.report_bucket_name
  }

  policy_statements = [
    {
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "${module.s3.report_bucket_arn}/*"
    }
  ]
}

# ── Lambda: processor（Pattern B）────────────────────────
module "lambda_processor" {
  source        = "../../modules/lambda"
  project       = var.project
  env           = var.env
  function_name = "processor"
  source_dir    = "../../lambda_src/processor"
  timeout       = 30
  tags          = local.tags

  environment_variables = {
    DYNAMODB_TABLE_NAME = aws_dynamodb_table.processed_files.name
  }

  policy_statements = [
    {
      Effect   = "Allow"
      Action   = ["dynamodb:PutItem"]
      Resource = aws_dynamodb_table.processed_files.arn
    }
  ]
}

# ── EventBridge モジュール ─────────────────────────────────
module "eventbridge" {
  source                = "../../modules/eventbridge"
  project               = var.project
  env                   = var.env
  tags                  = local.tags
  scheduler_lambda_arn  = module.lambda_scheduler.function_arn
  scheduler_lambda_name = module.lambda_scheduler.function_name
  processor_lambda_arn  = module.lambda_processor.function_arn
  processor_lambda_name = module.lambda_processor.function_name
  input_bucket_name     = module.s3.input_bucket_name
}
