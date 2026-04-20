variable "project" {
  description = "プロジェクト名（リソース命名プレフィックスに使用）"
  type        = string
}

variable "env" {
  description = "環境名（dev / stg / prod）"
  type        = string
}

variable "tags" {
  description = "全リソースに付与する共通タグ"
  type        = map(string)
}

variable "scheduler_lambda_arn" {
  description = "Pattern A: スケジュール実行 Lambda の ARN"
  type        = string
}

variable "scheduler_lambda_name" {
  description = "Pattern A: スケジュール実行 Lambda の関数名"
  type        = string
}

variable "processor_lambda_arn" {
  description = "Pattern B: S3 イベント処理 Lambda の ARN"
  type        = string
}

variable "processor_lambda_name" {
  description = "Pattern B: S3 イベント処理 Lambda の関数名"
  type        = string
}

variable "input_bucket_name" {
  description = "Pattern B: EventBridge 通知を受け取る S3 バケット名"
  type        = string
}
