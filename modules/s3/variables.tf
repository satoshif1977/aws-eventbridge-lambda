variable "project" {
  description = "プロジェクト名（リソース命名プレフィックスに使用）"
  type        = string
}

variable "env" {
  description = "環境名（dev / stg / prod）"
  type        = string
}

variable "account_id" {
  description = "AWS アカウント ID（バケット名のグローバル一意性確保に使用）"
  type        = string
}

variable "tags" {
  description = "全リソースに付与する共通タグ"
  type        = map(string)
}
