variable "project" {
  description = "プロジェクト名（リソース命名プレフィックスに使用）"
  type        = string
}

variable "env" {
  description = "環境名（dev / stg / prod）"
  type        = string
}

variable "function_name" {
  description = "Lambda 関数のサフィックス名（project-env-{function_name} 形式で命名される）"
  type        = string
}

variable "source_dir" {
  description = "Lambda デプロイパッケージのソースディレクトリパス"
  type        = string
}

variable "tags" {
  description = "全リソースに付与する共通タグ"
  type        = map(string)
}

variable "timeout" {
  description = "Lambda タイムアウト秒数"
  type        = number
  default     = 30
}

variable "memory_size" {
  description = "Lambda メモリサイズ（MB）"
  type        = number
  default     = 128
}

variable "environment_variables" {
  description = "Lambda に渡す環境変数のマップ"
  type        = map(string)
  default     = {}
}

variable "policy_statements" {
  description = "Lambda IAM ロールに追加するインラインポリシーのステートメント一覧"
  type        = list(any)
  default     = []
}

variable "log_retention_days" {
  description = "CloudWatch Logs の保持日数（dev: 30, prod: 90 を推奨）"
  type        = number
  default     = 30
}
