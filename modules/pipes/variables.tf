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

variable "enricher_lambda_arn" {
  description = "Pattern C: エンリッチメント Lambda の ARN"
  type        = string
}

variable "processor_lambda_arn" {
  description = "Pattern C: ターゲット（Processor）Lambda の ARN"
  type        = string
}
