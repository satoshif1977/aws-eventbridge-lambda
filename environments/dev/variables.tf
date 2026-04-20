variable "project" {
  description = "プロジェクト名（リソース命名プレフィックスに使用）"
  type        = string
  default     = "eventbridge-lambda"
}

variable "env" {
  description = "環境名（dev / stg / prod）"
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "デプロイ先 AWS リージョン"
  type        = string
  default     = "ap-northeast-1"
}
